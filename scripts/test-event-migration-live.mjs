import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {database} from "../server/db.ts";
const source=resolve(process.argv[2]),dir=mkdtempSync(join(tmpdir(),"event-upgrade-rehearsal-")),path=join(dir,"newbot.sqlite");
try{
 execFileSync("python3",["-c","import sqlite3,sys\na=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);b=sqlite3.connect(sys.argv[2]);a.backup(b);b.close();a.close()",source,path]);
 let db=new DatabaseSync(path);const version=db.prepare("PRAGMA user_version").get().user_version;
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const summarize=(sql)=>Object.fromEntries(tables.map(table=>[table,createHash("sha256").update(JSON.stringify(sql.prepare('SELECT * FROM "'+table+'" ORDER BY rowid').all())).digest("hex")]));
 const before=summarize(db);db.close();const migrated=database(dir);const after=summarize(migrated.raw);
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error("Existing data changed; inspect migration offline");
 console.log(JSON.stringify({from:version,to:migrated.raw.prepare("PRAGMA user_version").get().user_version,existingTables:tables.length,allExistingRowsUnchanged:true,migrationRecorded:!!migrated.raw.prepare("SELECT id FROM automation_event_migrations").get()}));migrated.raw.close();
}finally{rmSync(dir,{recursive:true,force:true});}
