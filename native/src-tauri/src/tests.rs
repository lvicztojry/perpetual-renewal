use super::*;
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
