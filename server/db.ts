import { PublicError } from "./public-error.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
export const DATABASE_VERSION = 17;
export function database(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "minimal-agent.sqlite");
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version > DATABASE_VERSION) {
    db.close();
    throw new PublicError("数据库版本较新，请使用匹配的应用版本或恢复备份");
  }
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runner_nodes(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT NOT NULL,expected_fingerprint TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,boot_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,stopped INTEGER NOT NULL DEFAULT 1,ack INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS runner_grants(node_id TEXT NOT NULL REFERENCES runner_nodes(id),scope TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(node_id,scope));
    CREATE TABLE IF NOT EXISTS runner_commands(id TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES runner_nodes(id),epoch INTEGER NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,payload TEXT,ephemeral INTEGER NOT NULL,reply TEXT,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runner_inbox(node_id TEXT NOT NULL REFERENCES runner_nodes(id),seq INTEGER NOT NULL,epoch INTEGER NOT NULL,kind TEXT NOT NULL,command_id TEXT,scope TEXT NOT NULL,fingerprint TEXT NOT NULL,packet TEXT NOT NULL,PRIMARY KEY(node_id,seq));

    CREATE TABLE IF NOT EXISTS configuration_operations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,result TEXT,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS private_field_sets(scope TEXT NOT NULL,target TEXT NOT NULL,revision TEXT NOT NULL,binding TEXT NOT NULL,specs TEXT NOT NULL,packet TEXT,PRIMARY KEY(scope,target));
    CREATE TABLE IF NOT EXISTS private_operations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS plugin_connection_settings(plugin_id TEXT NOT NULL,server TEXT NOT NULL,revision TEXT NOT NULL,package_digest TEXT NOT NULL,schema_digest TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(plugin_id,server));
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
    CREATE TABLE IF NOT EXISTS extension_imports(id TEXT PRIMARY KEY,state TEXT NOT NULL,content TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS extension_packages(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,digest TEXT NOT NULL,content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS extension_resource_versions(resource_id TEXT NOT NULL,digest TEXT NOT NULL,path TEXT NOT NULL,bytes INTEGER NOT NULL,content TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(resource_id,digest));
    CREATE TABLE IF NOT EXISTS extension_resource_refs(owner TEXT NOT NULL,resource_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(owner,resource_id,digest),FOREIGN KEY(resource_id,digest) REFERENCES extension_resource_versions(resource_id,digest));
    CREATE TABLE IF NOT EXISTS extension_import_operations(id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES extension_imports(id),fingerprint TEXT NOT NULL,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS extension_install_journal(id TEXT PRIMARY KEY,content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS extension_native_journal(id TEXT PRIMARY KEY,path TEXT NOT NULL,previous BLOB);
    CREATE TABLE IF NOT EXISTS message_media(
      id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),turn_id TEXT NOT NULL,item_id TEXT NOT NULL,
      source_key TEXT NOT NULL,reference TEXT,label TEXT NOT NULL,state TEXT NOT NULL,reason TEXT,
      artifact_id TEXT REFERENCES artifacts(id),created INTEGER NOT NULL,
      UNIQUE(thread_id,turn_id,item_id,source_key));
    CREATE INDEX IF NOT EXISTS message_media_item ON message_media(thread_id,turn_id,item_id);
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
    CREATE TABLE IF NOT EXISTS session_runtime_pending(thread_id TEXT PRIMARY KEY REFERENCES threads(id),revision INTEGER NOT NULL,candidate TEXT NOT NULL,state TEXT NOT NULL,error TEXT);
    CREATE TABLE IF NOT EXISTS session_runtime_versions(thread_id TEXT PRIMARY KEY REFERENCES threads(id),version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS session_runtime_requests(thread_id TEXT NOT NULL REFERENCES threads(id),revision INTEGER NOT NULL,turn_id TEXT NOT NULL,configuration TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(thread_id,revision));
    CREATE TABLE IF NOT EXISTS session_inputs(thread_id TEXT PRIMARY KEY REFERENCES threads(id),revision INTEGER NOT NULL,content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_plugins(request_id TEXT NOT NULL REFERENCES runs(request_id),position INTEGER NOT NULL,plugin_id TEXT NOT NULL,name TEXT NOT NULL,display_name TEXT NOT NULL,PRIMARY KEY(request_id,plugin_id));
    CREATE TABLE IF NOT EXISTS run_context(request_id TEXT PRIMARY KEY REFERENCES runs(request_id),context TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_configuration(id INTEGER PRIMARY KEY CHECK(id=1),format INTEGER NOT NULL,revision TEXT NOT NULL,content TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS thread_activity(thread_id TEXT PRIMARY KEY REFERENCES threads(id),state TEXT NOT NULL,turn_id TEXT,request_id TEXT,revision INTEGER NOT NULL,updated INTEGER NOT NULL,seen_revision INTEGER NOT NULL DEFAULT 0,recent TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS thread_workspaces(thread_id TEXT PRIMARY KEY REFERENCES threads(id),workspace_id TEXT UNIQUE,root TEXT NOT NULL,legacy INTEGER NOT NULL,revision TEXT NOT NULL,snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS extension_configuration(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,content TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS extension_assets(id TEXT PRIMARY KEY,identity TEXT NOT NULL UNIQUE,path TEXT NOT NULL,aliases TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS experts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,content TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS session_extensions(thread_id TEXT PRIMARY KEY REFERENCES threads(id),revision INTEGER NOT NULL,expert_id TEXT);
    CREATE TABLE IF NOT EXISTS run_experts(request_id TEXT PRIMARY KEY REFERENCES runs(request_id),expert_id TEXT NOT NULL,name TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS thread_waits(thread_id TEXT PRIMARY KEY REFERENCES threads(id),summary TEXT NOT NULL);
    PRAGMA user_version=${DATABASE_VERSION};
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL,decision TEXT NOT NULL); COMMIT;`);
  db.exec(
    "UPDATE thread_activity SET state='unknown',revision=revision+1 WHERE state IN ('preparing','running','waiting')",
  );
  db.exec("DELETE FROM thread_waits");
  db.exec(
    "UPDATE message_media SET state='failed',reason='图片保存被服务重启中断，请重新生成' WHERE state='pending'",
  );
  db.exec(
    "INSERT INTO session_runtime_versions SELECT thread_id,1 FROM session_runtime_pending WHERE state='applying' ON CONFLICT(thread_id) DO UPDATE SET version=version+1",
  );
  db.exec(
    "UPDATE session_runtime_pending SET state='failed',error='应用过程被中断，请在下次发送前重试或撤销。' WHERE state='applying'",
  );
  db.exec("UPDATE session_runtime_pending SET state='pending',error=NULL WHERE state IN ('accepted','unknown')");
  // A crash after dispatch has an unknown outcome. Never automatically resubmit it.
  db.prepare(
    "UPDATE runs SET state='unknown' WHERE state IN ('reserved','dispatching')",
  ).run();
  db.prepare(
    "UPDATE artifact_sources SET state='failed',reason='capture_interrupted' WHERE state='pending'",
  ).run();
  return {
    directory: resolve(directory),
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
        .prepare(
          "SELECT t.*,a.state activity_state,a.turn_id activity_turn,a.revision activity_revision,a.updated activity_updated,a.seen_revision activity_seen,w.summary activity_waiting FROM threads t LEFT JOIN thread_activity a ON a.thread_id=t.id LEFT JOIN thread_waits w ON w.thread_id=t.id WHERE t.archived=0 ORDER BY t.updated DESC",
        )
        .all()
        .map((r) => {
          const {
            activity_state,
            activity_turn,
            activity_revision,
            activity_updated,
            activity_seen,
            activity_waiting,
            ...thread
          } = r;
          return {
            ...thread,
            ...(activity_state
              ? {
                  activity: {
                    state: activity_state,
                    turnId: activity_turn,
                    revision: activity_revision,
                    updated: activity_updated,
                    seenRevision: activity_seen,
                    ...(activity_waiting
                      ? { waiting: JSON.parse(String(activity_waiting)) }
                      : {}),
                  },
                }
              : {}),
          };
        });
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
