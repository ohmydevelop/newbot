import pathlib
import sqlite3
import tempfile
import unittest
from deployment_database import columns, summaries, validate_migration, restore_database


class MigrationTests(unittest.TestCase):
    def test_migration_preserves_data_and_rollback_restores_version(self):
        with tempfile.TemporaryDirectory() as root:
            db_path = pathlib.Path(root) / "live.sqlite"
            saved_path = pathlib.Path(root) / "saved.sqlite"
            with sqlite3.connect(db_path) as db:
                db.executescript("CREATE TABLE session_runtime(id TEXT PRIMARY KEY, approval TEXT); INSERT INTO session_runtime VALUES('old','full'); PRAGMA user_version=17;")
                selected = columns(db, ["session_runtime"])
                before = summaries(db, selected)
                with sqlite3.connect(saved_path) as saved:
                    db.backup(saved)
                db.executescript("ALTER TABLE session_runtime ADD COLUMN mode TEXT NOT NULL DEFAULT 'work'; PRAGMA user_version=18;")
                validate_migration(db, "session-modes-v18", 17, selected)
                self.assertEqual(summaries(db, selected), before)
                with self.assertRaises(RuntimeError):
                    validate_migration(db, None, 17, selected)
                with self.assertRaises(RuntimeError):
                    validate_migration(db, "session-modes-v18", 18, selected)
                db.execute("UPDATE session_runtime SET mode='chat'")
                with self.assertRaises(RuntimeError):
                    validate_migration(db, "session-modes-v18", 17, selected)
                db.execute("UPDATE session_runtime SET approval='ask'")
                self.assertNotEqual(summaries(db, selected), before)
            restore_database(saved_path, db_path)
            with sqlite3.connect(db_path) as db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 17)
                self.assertEqual(columns(db, selected), selected)
                self.assertEqual(summaries(db, selected), before)

    def test_automation_migration_and_rollback(self):
        with tempfile.TemporaryDirectory() as root:
            live=pathlib.Path(root)/"live.sqlite"
            saved=pathlib.Path(root)/"saved.sqlite"
            with sqlite3.connect(live) as db:
                db.executescript("CREATE TABLE session_runtime(id TEXT,mode TEXT); INSERT INTO session_runtime VALUES('old','chat'); PRAGMA user_version=18;")
                selected=columns(db,["session_runtime"])
                before=summaries(db,selected)
                with sqlite3.connect(saved) as backup: db.backup(backup)
                tables=["automation_tasks","automation_runs","automation_attachment_refs","automation_mail_config","automation_deliveries"]
                for table in tables: db.execute("CREATE TABLE "+table+"(id TEXT)")
                db.execute("PRAGMA user_version=19")
                validate_migration(db,"automations-v19",18,selected)
                self.assertEqual(summaries(db,selected),before)
                db.execute("INSERT INTO automation_tasks VALUES('unexpected')")
                with self.assertRaises(RuntimeError): validate_migration(db,"automations-v19",18,selected)
            restore_database(saved,live)
            with sqlite3.connect(live) as db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0],18)
                self.assertEqual(summaries(db,selected),before)
                self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='automation_tasks'").fetchone())

    def test_event_migration_preserves_old_tasks_and_rollback(self):
        with tempfile.TemporaryDirectory() as root:
            live=pathlib.Path(root)/"live.sqlite"
            saved=pathlib.Path(root)/"saved.sqlite"
            with sqlite3.connect(live) as db:
                db.executescript("CREATE TABLE automation_tasks(id TEXT,content TEXT); INSERT INTO automation_tasks VALUES('old','{\"triggers\":[]}'); CREATE TABLE automation_runs(id TEXT,thread_id TEXT); INSERT INTO automation_runs VALUES('old-run','historical-thread'); PRAGMA user_version=19;")
                selected=columns(db,["automation_tasks","automation_runs"])
                before=summaries(db,selected)
                with sqlite3.connect(saved) as backup: db.backup(backup)
                for table in ["automation_threads","automation_event_routes","automation_event_inbox"]:
                    db.execute("CREATE TABLE "+table+"(id TEXT)")
                db.execute("PRAGMA user_version=20")
                validate_migration(db,"automation-events-v20",19,selected)
                self.assertEqual(summaries(db,selected),before)
                with self.assertRaises(RuntimeError): validate_migration(db,None,19,selected)
                db.execute("DROP TABLE automation_event_routes")
                with self.assertRaises(RuntimeError): validate_migration(db,"automation-events-v20",19,selected)
            restore_database(saved,live)
            with sqlite3.connect(live) as db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0],19)
                self.assertEqual(summaries(db,selected),before)
                self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='automation_threads'").fetchone())

    def test_event_bridge_v23_requires_completion_marker_and_preserves_existing_tables(self):
        with sqlite3.connect(":memory:") as db:
            db.executescript("CREATE TABLE automation_tasks(id TEXT,content TEXT); INSERT INTO automation_tasks VALUES('old','{}'); PRAGMA user_version=20;")
            selected=columns(db,["automation_tasks"]); before=summaries(db,selected)
            for table in ["automation_event_accounts","automation_event_oauth","automation_event_webhooks","automation_event_migrations"]:
                db.execute("CREATE TABLE "+table+"(id TEXT)")
            db.execute("PRAGMA user_version=23")
            with self.assertRaises(RuntimeError): validate_migration(db,"event-bridge-v23",20,selected)
            db.execute("INSERT INTO automation_event_migrations VALUES('event-config-v2-preserve-identities')")
            validate_migration(db,"event-bridge-v23",20,selected)
            self.assertEqual(summaries(db,selected),before)
            with self.assertRaises(RuntimeError): validate_migration(db,"event-bridge-v23",21,selected)

unittest.main()
