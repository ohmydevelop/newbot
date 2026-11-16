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


unittest.main()
