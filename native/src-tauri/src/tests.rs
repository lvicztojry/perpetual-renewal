use super::*;

#[test]
fn migration_line_endings_preserve_both_released_histories_without_accepting_edits() {
    let lf = INITIAL_SCHEMA.replace("\r\n", "\n");
    let crlf = lf.replace('\n', "\r\n");
    for old_sql in [&lf, &crlf] {
        let folder = Sandbox::new();
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection, &folder.0, &[(1, old_sql)]).unwrap();
        // Reproduce the exact historical algorithm, not the fixed writer.
        let old_hash = format!("{:x}", Sha256::digest(old_sql.as_bytes()));
        connection.execute("UPDATE schema_history SET checksum=?1 WHERE version=1", [&old_hash]).unwrap();
        connection.execute("UPDATE local_document SET body=?1,revision=19", [r#"{"format":1,"accounts":[{"id":"fixture","state":"sealed"}]}"#]).unwrap();
        let before: String = connection.query_row("SELECT body FROM local_document", [], |r| r.get(0)).unwrap();
        for new_sql in [&lf, &crlf] {
            migrate(&mut connection, &folder.0, &[(1, new_sql)]).unwrap();
            let retained: String = connection.query_row("SELECT checksum FROM schema_history", [], |r| r.get(0)).unwrap();
            assert_eq!(retained, old_hash);
            assert!(migrate(&mut connection, &folder.0, &[(1, &format!("{}\n-- edited", new_sql))]).is_err());
        }
        let after: String = connection.query_row("SELECT body FROM local_document", [], |r| r.get(0)).unwrap();
        assert_eq!(before, after);
    }
    assert_eq!(migration_checksum(&lf), migration_checksum(&crlf));
    assert_eq!(migration_checksum(INITIAL_SCHEMA), "057a1d7d2f6c1f68f61ab4f642a5ec322fd0a96a8e39ff8846e5a9943e85d213");
}
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("renewal-local-test-{}-{}", std::process::id(), stamp));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Sandbox { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
#[test]
fn updates_preserve_document_and_refuse_downgrade_or_edited_history() {
    let folder = Sandbox::new();
    let mut connection = Connection::open(folder.0.join("test.sqlite3")).unwrap();
    migrate(&mut connection, &folder.0, MIGRATIONS).unwrap();
    let body = r#"{"format":1,"accounts":[{"id":"fixture","state":{"data":"sealed-fixture"}}]}"#;
    connection.execute("UPDATE local_document SET body=?1,revision=7 WHERE id=1", [body]).unwrap();
    let upgrade = [(1, INITIAL_SCHEMA), (2, "ALTER TABLE local_document ADD COLUMN upgrade_marker TEXT")];
    migrate(&mut connection, &folder.0, &upgrade).unwrap();
    let retained: String = connection.query_row("SELECT body FROM local_document", [], |row| row.get(0)).unwrap();
    assert_eq!(retained, body);
    assert!(migrate(&mut connection, &folder.0, MIGRATIONS).is_err());
    assert!(migrate(&mut connection, &folder.0, &[(1, "changed history"), (2, upgrade[1].1)]).is_err());
    assert!(fs::read_dir(folder.0.join("backups")).unwrap().next().is_some());
}
#[test]
fn failed_migration_rolls_back_and_unrecognized_data_is_never_reset() {
    let folder = Sandbox::new();
    let mut connection = Connection::open(folder.0.join("test.sqlite3")).unwrap();
    migrate(&mut connection, &folder.0, MIGRATIONS).unwrap();
    let upgrade = [(1, INITIAL_SCHEMA), (2, "ALTER TABLE local_document ADD COLUMN rollback_me TEXT; INVALID SQL;")];
    assert!(migrate(&mut connection, &folder.0, &upgrade).is_err());
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
    assert_eq!(version, 1);
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM pragma_table_info('local_document') WHERE name='rollback_me'", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 0);
    let mut foreign = Connection::open_in_memory().unwrap();
    foreign.execute("CREATE TABLE existing_private_data(value TEXT)", []).unwrap();
    assert!(migrate(&mut foreign, &folder.0, MIGRATIONS).is_err());
}
#[test]
fn restore_names_cannot_escape_backup_directory() {
    assert!(valid_backup_name("renewal-123.sqlite3"));
    for name in ["../renewal-123.sqlite3", "renewal-/123.sqlite3", "renewal-.sqlite3", "renewal-123.sqlite3/other"] {
        assert!(!valid_backup_name(name));
    }
}
