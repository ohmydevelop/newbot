import { PublicError } from "./public-error.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
export function database(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "minimal-agent.sqlite");
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version > 7) {
    db.close();
    throw new PublicError("数据库版本较新，请使用匹配的应用版本或恢复备份");
  }
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,updated INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS runs(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,state TEXT NOT NULL,thread_id TEXT,turn_id TEXT,client_message_id TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created INTEGER NOT NULL,legacy INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS run_attachments(request_id TEXT NOT NULL REFERENCES runs(request_id),file_id TEXT NOT NULL REFERENCES attachments(id),PRIMARY KEY(request_id,file_id));
    CREATE TABLE IF NOT EXISTS artifacts(
      id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),turn_id TEXT NOT NULL,item_id TEXT,
      path TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,version INTEGER NOT NULL,source TEXT NOT NULL,created INTEGER NOT NULL,
      UNIQUE(thread_id,path,version));
    CREATE INDEX IF NOT EXISTS artifacts_turn ON artifacts(thread_id,turn_id);
    CREATE TABLE IF NOT EXISTS artifact_sources(
      thread_id TEXT NOT NULL REFERENCES threads(id),turn_id TEXT NOT NULL,item_id TEXT NOT NULL,path TEXT NOT NULL,
      state TEXT NOT NULL,reason TEXT,artifact_id TEXT REFERENCES artifacts(id),created INTEGER NOT NULL,
      PRIMARY KEY(thread_id,turn_id,item_id,path));
    CREATE TABLE IF NOT EXISTS run_skills(
      request_id TEXT NOT NULL REFERENCES runs(request_id),position INTEGER NOT NULL,skill_id TEXT NOT NULL,
      name TEXT NOT NULL,display_name TEXT NOT NULL,scope TEXT NOT NULL,sha256 TEXT NOT NULL,
      PRIMARY KEY(request_id,skill_id));
    CREATE TABLE IF NOT EXISTS a2ui_views(
      id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),turn_id TEXT NOT NULL,item_id TEXT NOT NULL,
      surface_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT,expires INTEGER,
      format INTEGER NOT NULL DEFAULT 1,snapshot TEXT NOT NULL,bytes INTEGER NOT NULL,updated INTEGER NOT NULL,
      UNIQUE(thread_id,turn_id,surface_id));
    CREATE TABLE IF NOT EXISTS a2ui_calls(
      thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,call_id TEXT NOT NULL,view_id TEXT NOT NULL REFERENCES a2ui_views(id) ON DELETE CASCADE,
      PRIMARY KEY(thread_id,turn_id,call_id));
    CREATE INDEX IF NOT EXISTS a2ui_calls_view ON a2ui_calls(view_id);
    CREATE TABLE IF NOT EXISTS a2ui_drafts(
      view_id TEXT PRIMARY KEY REFERENCES a2ui_views(id) ON DELETE CASCADE,view_revision INTEGER NOT NULL,
      version INTEGER NOT NULL,content TEXT NOT NULL,bytes INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS a2ui_receipts(
      request_id TEXT PRIMARY KEY,view_id TEXT NOT NULL REFERENCES a2ui_views(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS managed_credentials(
      scope TEXT NOT NULL,target TEXT NOT NULL,ref TEXT PRIMARY KEY,binding TEXT NOT NULL,version TEXT NOT NULL,updated INTEGER NOT NULL,
      nonce BLOB NOT NULL,ciphertext BLOB NOT NULL,tag BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS session_runtime(thread_id TEXT PRIMARY KEY REFERENCES threads(id),revision INTEGER NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL,approval TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_plugins(request_id TEXT NOT NULL REFERENCES runs(request_id),position INTEGER NOT NULL,plugin_id TEXT NOT NULL,name TEXT NOT NULL,display_name TEXT NOT NULL,PRIMARY KEY(request_id,plugin_id));
    CREATE TABLE IF NOT EXISTS run_context(request_id TEXT PRIMARY KEY REFERENCES runs(request_id),context TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_configuration(id INTEGER PRIMARY KEY CHECK(id=1),format INTEGER NOT NULL,revision TEXT NOT NULL,content TEXT NOT NULL,updated INTEGER NOT NULL);
    PRAGMA user_version=7;
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL,decision TEXT NOT NULL); COMMIT;`);
  // A crash after dispatch has an unknown outcome. Never automatically resubmit it.
  db.prepare(
    "UPDATE runs SET state='unknown' WHERE state IN ('reserved','dispatching')",
  ).run();
  db.prepare(
    "UPDATE artifact_sources SET state='failed',reason='capture_interrupted' WHERE state='pending'",
  ).run();
  return {
    raw: db,
    provider(id: string) {
      return (
        db.prepare("SELECT provider FROM threads WHERE id=?").get(id) as
          | { provider: string }
          | undefined
      )?.provider;
    },
    revokeSessions() {
      db.exec("DELETE FROM sessions");
    },
    get(key: string) {
      return (
        db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as
          | { value: string }
          | undefined
      )?.value;
    },
    set(key: string, value: string) {
      db.prepare("INSERT OR REPLACE INTO metadata VALUES(?,?)").run(key, value);
    },
    createSession() {
      const token = randomBytes(32).toString("base64url");
      db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(
        hash(token),
        Date.now() + 7 * 86400000,
      );
      return token;
    },
    validSession(token?: string) {
      return (
        !!token &&
        !!db
          .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
          .get(hash(token), Date.now())
      );
    },
    logout(token: string) {
      db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    },
    owns(id: string) {
      return !!db.prepare("SELECT id FROM threads WHERE id=?").get(id);
    },
    addThread(id: string, provider: string) {
      db.prepare(
        "INSERT OR IGNORE INTO threads(id,title,provider,updated) VALUES(?,?,?,?)",
      ).run(id, "新对话", provider, Date.now());
    },
    touch(id: string) {
      db.prepare("UPDATE threads SET updated=? WHERE id=?").run(Date.now(), id);
    },
    rename(id: string, title: string) {
      db.prepare("UPDATE threads SET title=? WHERE id=?").run(title, id);
    },
    archive(id: string) {
      db.prepare("UPDATE threads SET archived=1 WHERE id=?").run(id);
    },
    list() {
      return db
        .prepare("SELECT * FROM threads WHERE archived=0 ORDER BY updated DESC")
        .all();
    },
    audit(action: string, subject: string, decision: string) {
      db.prepare(
        "INSERT INTO audit(at,action,subject,decision) VALUES(?,?,?,?)",
      ).run(Date.now(), action, subject, decision);
    },
  };
}
export type Store = ReturnType<typeof database>;
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
