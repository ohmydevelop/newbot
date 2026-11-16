import hashlib
import json
import sqlite3


def columns(connection, tables):
    return {table: [row[1] for row in connection.execute('PRAGMA table_info("' + table + '")')] for table in tables}


def summaries(connection, selected):
    result = {}
    for table, names in selected.items():
        query = 'SELECT ' + ','.join('"' + name + '"' for name in names) + ' FROM "' + table + '" ORDER BY 1'
        rows = connection.execute(query).fetchall()
        result[table] = {"count": len(rows), "sha256": hashlib.sha256(json.dumps(rows, default=str).encode()).hexdigest()}
    return result


def validate_migration(connection, migration, previous_version, selected):
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    actual = columns(connection, selected)
    expected = dict(selected)
    if migration == "session-modes-v18":
        if previous_version != 17 or version != 18:
            raise RuntimeError("Expected database migration v17 to v18")
        expected["session_runtime"] = selected["session_runtime"] + ["mode"]
        if connection.execute("SELECT count(*) FROM session_runtime WHERE mode != 'work'").fetchone()[0]:
            raise RuntimeError("Historical session mode was not preserved as work")
    elif migration == "automations-v19":
        if previous_version != 18 or version != 19:
            raise RuntimeError("Expected database migration v18 to v19")
        for table in ["automation_tasks", "automation_runs", "automation_attachment_refs", "automation_mail_config", "automation_deliveries"]:
            if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                raise RuntimeError("Missing automation table: " + table)
            if connection.execute('SELECT count(*) FROM "' + table + '"').fetchone()[0]:
                raise RuntimeError("Automation tables must be empty at first deployment")
    elif migration == "automation-events-v20":
        if previous_version != 19 or version != 20:
            raise RuntimeError("Expected database migration v19 to v20")
        for table in ["automation_threads", "automation_event_routes", "automation_event_inbox"]:
            if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                raise RuntimeError("Missing automation event table: " + table)
    elif version != previous_version:
        raise RuntimeError("Unexpected database version change")
    if actual != expected:
        raise RuntimeError("Unexpected database schema change")


def restore_database(saved_path, target_path):
    with sqlite3.connect(saved_path) as saved, sqlite3.connect(target_path) as target:
        saved.backup(target)
        target.execute("PRAGMA wal_checkpoint(TRUNCATE)")
