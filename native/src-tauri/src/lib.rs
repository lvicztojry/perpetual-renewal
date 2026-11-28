use rusqlite::{params, Connection, DatabaseName};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;

mod speech;

const SCHEMA_VERSION: i64 = 1;
const INITIAL_SCHEMA: &str = include_str!("../../migrations/0001_local_state.sql");
const MIGRATIONS: &[(i64, &str)] = &[(1, INITIAL_SCHEMA)];

fn migration_checksum(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.replace("\r\n", "\n").as_bytes()))
}

fn migration_checksum_matches(stored: &str, sql: &str) -> bool {
    // Released builds hashed include_str! bytes before line endings were pinned.
    // Accept only the exact LF/CRLF representations of the same SQL, never
    // whitespace trimming or a bypass of the migration integrity check.
    let lf = sql.replace("\r\n", "\n");
    stored == migration_checksum(&lf)
        || stored == format!("{:x}", Sha256::digest(lf.replace('\n', "\r\n").as_bytes()))
        || stored == format!("{:x}", Sha256::digest(sql.as_bytes()))
}

struct LocalDatabase { connection: Mutex<Connection>, directory: PathBuf }
#[derive(Serialize)]
struct Document { revision: i64, body: String }

fn backup(connection: &Connection, directory: &PathBuf) -> Result<String, String> {
    let folder = directory.join("backups");
    fs::create_dir_all(&folder).map_err(|_| "Cannot create backup directory.")?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Clock unavailable.")?.as_nanos();
    let name = format!("renewal-{}.sqlite3", stamp);
    connection.backup(DatabaseName::Main, folder.join(&name), None).map_err(|_| "Database backup failed.")?;
    Ok(name)
}

fn migrate(connection: &mut Connection, directory: &PathBuf, migrations: &[(i64, &str)]) -> Result<(), String> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|_| "Cannot read schema version.")?;
    let latest = migrations.last().map(|item| item.0).unwrap_or(0);
    if version > latest { return Err("Data belongs to a newer application; downgrades cannot reset it.".into()); }
    if version == 0 {
        let tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |row| row.get(0)).map_err(|_| "Cannot inspect database.")?;
        if tables != 0 { return Err("Unrecognized existing database; preserve it for recovery.".into()); }
    }
    for (index, (number, sql)) in migrations.iter().enumerate() {
        if *number != index as i64 + 1 { return Err("Migration sequence has a gap.".into()); }
        if *number <= version {
            let stored: String = connection.query_row("SELECT checksum FROM schema_history WHERE version=?1", [number], |row| row.get(0)).map_err(|_| "Missing schema history; do not reset data.")?;
            if !migration_checksum_matches(&stored, sql) { return Err("Previously applied migration was modified; update refused.".into()); }
        }
    }
    if version == latest { return Ok(()); }
    if version > 0 { backup(connection, directory)?; }
    let transaction = connection.transaction().map_err(|_| "Cannot begin schema migration.")?;
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS schema_history(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)").map_err(|_| "Cannot create migration history.")?;
    for (number, sql) in migrations.iter().filter(|item| item.0 > version) {
        transaction.execute_batch(sql).map_err(|_| "Schema migration failed; prior data was retained.")?;
        let checksum = migration_checksum(sql);
        transaction.execute("INSERT INTO schema_history(version,checksum) VALUES(?1,?2)", params![number, checksum]).map_err(|_| "Cannot save migration history.")?;
    }
    transaction.pragma_update(None, "user_version", latest).map_err(|_| "Cannot save schema version.")?;
    transaction.commit().map_err(|_| "Cannot commit schema migration.")?;
    Ok(())
}

fn open_database(directory: PathBuf) -> Result<LocalDatabase, String> {
    fs::create_dir_all(&directory).map_err(|_| "Cannot open application data directory.")?;
    let mut connection = Connection::open(directory.join("renewal.sqlite3")).map_err(|_| "Cannot open local database.")?;
    connection.busy_timeout(std::time::Duration::from_secs(10)).map_err(|_| "Cannot configure database.")?;
    if MIGRATIONS.last().map(|item| item.0) != Some(SCHEMA_VERSION) { return Err("Application schema version is inconsistent.".into()); }
    migrate(&mut connection, &directory, MIGRATIONS)?;
    // Back up once per new application version, including code-only updates.
    let body: String = connection.query_row("SELECT body FROM local_document WHERE id=1", [], |row| row.get(0)).map_err(|_| "Cannot read application version metadata.")?;
    let mut document: serde_json::Value = serde_json::from_str(&body).map_err(|_| "Invalid local document; preserve it.")?;
    if document.get("format").and_then(|value| value.as_i64()) != Some(1) || !document.get("accounts").is_some_and(|value| value.is_array()) { return Err("Incompatible account data format; update refused.".into()); }
    if document.get("lastApplicationVersion").and_then(|value| value.as_str()) != Some(env!("CARGO_PKG_VERSION")) {
        if document.get("accounts").and_then(|value| value.as_array()).is_some_and(|accounts| !accounts.is_empty()) { backup(&connection, &directory)?; }
        document["lastApplicationVersion"] = serde_json::Value::String(env!("CARGO_PKG_VERSION").into());
        connection.execute("UPDATE local_document SET body=?1,revision=revision+1 WHERE id=1", [document.to_string()]).map_err(|_| "Cannot save application version metadata.")?;
    }
    Ok(LocalDatabase { connection: Mutex::new(connection), directory })
}

#[tauri::command]
fn read_database(state: tauri::State<LocalDatabase>) -> Result<Document, String> {
    let connection = state.connection.lock().map_err(|_| "Database lock unavailable.")?;
    connection.query_row("SELECT revision,body FROM local_document WHERE id=1", [], |row| Ok(Document { revision: row.get(0)?, body: row.get(1)? })).map_err(|_| "Cannot read local data.".into())
}

#[tauri::command]
fn commit_database(state: tauri::State<LocalDatabase>, expected_revision: i64, body: String) -> Result<i64, String> {
    if body.len() > 128 * 1024 * 1024 || expected_revision < 0 || expected_revision == i64::MAX { return Err("Unsupported document size or revision.".into()); }
    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|_| "Invalid local document.")?;
    if parsed.get("format").and_then(|v| v.as_i64()) != Some(1) || !parsed.get("accounts").is_some_and(|v| v.is_array()) { return Err("Unsupported local data format.".into()); }
    let connection = state.connection.lock().map_err(|_| "Database lock unavailable.")?;
    let changed = connection.execute("UPDATE local_document SET body=?1, revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=?2", params![body, expected_revision]).map_err(|_| "Local write failed; preserve existing data.")?;
    if changed != 1 { return Err("Local data changed concurrently; reload before retrying.".into()); }
    Ok(expected_revision + 1)
}

#[tauri::command]
fn backup_database(state: tauri::State<LocalDatabase>) -> Result<String, String> {
    let connection = state.connection.lock().map_err(|_| "Database lock unavailable.")?;
    backup(&connection, &state.directory)
}

#[tauri::command]
fn list_backups(state: tauri::State<LocalDatabase>) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(state.directory.join("backups")).map_err(|_| "Cannot list backups.")?;
    let mut names: Vec<String> = entries.filter_map(|entry| entry.ok()).filter_map(|entry| entry.file_name().to_str().map(str::to_owned)).filter(|name| valid_backup_name(name)).collect();
    names.sort(); names.reverse();
    Ok(names)
}
fn valid_backup_name(name: &str) -> bool {
    name.strip_prefix("renewal-").and_then(|value| value.strip_suffix(".sqlite3")).is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
}
#[tauri::command]
fn restore_backup(state: tauri::State<LocalDatabase>, name: String, confirmation: String) -> Result<(), String> {
    if confirmation != "恢复备份" || !valid_backup_name(&name) { return Err("Backup restoration was not confirmed.".into()); }
    let path = state.directory.join("backups").join(name);
    let source = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| "Cannot open selected backup.")?;
    let check: String = source.query_row("PRAGMA quick_check", [], |row| row.get(0)).map_err(|_| "Backup integrity check failed.")?;
    let version: i64 = source.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|_| "Cannot read backup version.")?;
    if check != "ok" || version != SCHEMA_VERSION { return Err("Backup is not compatible; preserve it for recovery.".into()); }
    let payload: String = source.query_row("SELECT body FROM local_document WHERE id=1", [], |row| row.get(0)).map_err(|_| "Invalid backup payload.")?;
    let payload: serde_json::Value = serde_json::from_str(&payload).map_err(|_| "Invalid backup payload.")?;
    if payload.get("format").and_then(|value| value.as_i64()) != Some(1) || !payload.get("accounts").is_some_and(|value| value.is_array()) { return Err("Backup payload is incompatible.".into()); }
    let source_revision: i64 = source.query_row("SELECT revision FROM local_document WHERE id=1", [], |row| row.get(0)).map_err(|_| "Invalid backup document.")?;
    drop(source);
    let mut connection = state.connection.lock().map_err(|_| "Database lock unavailable.")?;
    let current_revision: i64 = connection.query_row("SELECT revision FROM local_document WHERE id=1", [], |row| row.get(0)).map_err(|_| "Cannot read current revision.")?;
    let next = current_revision.max(source_revision).checked_add(1).ok_or("Revision exhausted.")?;
    backup(&connection, &state.directory)?;
    connection.restore(DatabaseName::Main, path, None::<fn(rusqlite::backup::Progress)>).map_err(|_| "Backup restoration failed.")?;
    connection.execute("UPDATE local_document SET revision=?1 WHERE id=1", [next]).map_err(|_| "Cannot finish restoration.")?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_http::init());
    let builder = builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init());
    let builder = builder.plugin(speech::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") { let _ = window.set_focus(); }
    }));
    builder
        .setup(|app| {
            // Optional per-process profile directory supports portable use and isolated upgrade QA.
            let directory = match std::env::var_os("RENEWAL_DATA_DIR") {
                Some(value) => {
                    let path = PathBuf::from(value);
                    if !path.is_absolute() { return Err(std::io::Error::other("RENEWAL_DATA_DIR must be absolute.").into()); }
                    path
                }
                None => app.path().app_data_dir()?,
            };
            let database = open_database(directory).map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_database, commit_database, backup_database, list_backups, restore_backup])
        .run(tauri::generate_context!())
        .expect("Local application could not start; preserve application data for recovery.");
}

#[cfg(test)]
mod tests;
