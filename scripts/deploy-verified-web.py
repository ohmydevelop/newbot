#!/usr/bin/env python3
import argparse
import hashlib
import http.cookiejar
import json
import pathlib
import shutil
import sqlite3
import subprocess
import time
import urllib.request
from deployment_database import columns, summaries, validate_migration, restore_database
from release_integrity import directory_hash

parser = argparse.ArgumentParser(description="Publish verified web assets and optionally the server; retain database and tunnel configuration.")
parser.add_argument("--target", required=True)
parser.add_argument("--origin", required=True)
parser.add_argument("--receipt", required=True)
parser.add_argument("--service", required=True)
parser.add_argument("--evidence", required=True)
parser.add_argument("--include-server", action="store_true")
parser.add_argument("--expected-server-hash")
parser.add_argument("--database-migration", choices=["session-modes-v18", "automations-v19", "automation-events-v20", "event-bridge-v23"])
args = parser.parse_args()
if args.database_migration and not args.include_server:
    parser.error("Database migrations require --include-server")
source = pathlib.Path(__file__).resolve().parents[1]
target = pathlib.Path(args.target).resolve()
receipt = pathlib.Path(args.receipt).resolve()
subprocess.run(["node", "--import", "tsx", "scripts/verify-release.ts", "dist/web", str(receipt), *(["--include-server"] if args.include_server else [])], cwd=source, check=True)
manifest = json.loads((source / "dist/web/release-manifest.json").read_text())
release = manifest["source"][:12]
backup = target / ".data/backups" / (time.strftime("%Y-%m-%d-web-") + release)
if args.include_server:
    actual = hashlib.sha256((target / "dist/server/index.js").read_bytes()).hexdigest()
    if not args.expected_server_hash or actual != args.expected_server_hash:
        raise RuntimeError("Running backend differs from the reviewed deployment baseline")
backup.mkdir(mode=0o700, parents=True)
stage = target / ".data" / ("staged-web-" + release)
old = target / ".data" / ("previous-web-" + release)
if stage.exists() or old.exists():
    raise RuntimeError("Release staging already exists; inspect it before retrying")
shutil.copytree(source / "dist/web", stage)
server_stage = target / ".data" / ("staged-server-" + release)
server_old = target / ".data" / ("previous-server-" + release)
if args.include_server:
    if server_stage.exists() or server_old.exists():
        raise RuntimeError("Server staging already exists")
    shutil.copytree(source / "dist/server", server_stage)
retained = 0
for asset in (target / "dist/web/assets").rglob("*"):
    if asset.is_file():
        destination = stage / "assets" / asset.relative_to(target / "dist/web/assets")
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(asset, destination)
            retained += 1
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(path, body=None):
    req = urllib.request.Request(args.origin + path, data=json.dumps(body).encode() if body is not None else None,
        headers={"Origin": args.origin, "Content-Type": "application/json"})
    with client.open(req, timeout=60) as response:
        return json.load(response)
request("/api/login", {"password": (target / ".data/initial-password").read_text().strip()})
request("/api/agent/action", {"action": "bridge/maintenance", "enabled": True})
tables = ["threads", "session_runtime", "session_runtime_pending", "thread_workspaces", "plugin_connection_settings", "private_field_sets", "provider_configuration", "extension_configuration", "experts", "session_extensions"]
if args.database_migration in ["automation-events-v20", "event-bridge-v23"]:
    tables += ["automation_tasks", "automation_runs", "automation_deliveries", "automation_mail_config"]
if args.database_migration == "event-bridge-v23":
    tables += ["automation_threads", "automation_event_routes", "automation_event_inbox", "automation_attachment_refs"]
def systemctl(action):
    subprocess.run(["systemctl", "--user", action, args.service], check=True)
swapped = False
server_swapped = False
stopped = False
try:
    systemctl("stop")
    stopped = True
    with sqlite3.connect(target / ".data/newbot.sqlite") as connection:
        previous_version = connection.execute("PRAGMA user_version").fetchone()[0]
        if args.database_migration and previous_version != {"session-modes-v18":17,"automations-v19":18,"automation-events-v20":19,"event-bridge-v23":20}[args.database_migration]:
            raise RuntimeError("Database version does not match migration baseline")
        selected = columns(connection, tables)
        with sqlite3.connect(backup / "database.sqlite") as saved:
            connection.backup(saved)
        before = summaries(connection, selected)
    (backup / "baseline.json").write_text(json.dumps(before))
    shutil.copytree(target / "dist/web", backup / "web")
    backend = hashlib.sha256((target / "dist/server/index.js").read_bytes()).hexdigest()
    if args.include_server:
        shutil.copytree(target / "dist/server", backup / "server")
    (target / "dist/web").rename(old)
    try:
        stage.rename(target / "dist/web")
    except Exception:
        old.rename(target / "dist/web")
        systemctl("start")
        raise
    swapped = True
    if args.include_server:
        (target / "dist/server").rename(server_old)
        try:
            server_stage.rename(target / "dist/server")
        except Exception:
            server_old.rename(target / "dist/server")
            raise
        server_swapped = True
    systemctl("start")
    for attempt in range(40):
        try:
            ready = request("/api/ready")
            if ready.get("ready"):
                break
        except Exception:
            pass
        time.sleep(0.5)
    else:
        raise RuntimeError("Published service did not become ready")
    request("/api/agent/action", {"action": "bridge/maintenance", "enabled": True})
    with sqlite3.connect("file:" + str(target / ".data/newbot.sqlite") + "?mode=ro", uri=True) as connection:
        validate_migration(connection, args.database_migration, previous_version, selected)
        after = summaries(connection, selected)
    if before != after:
        raise RuntimeError("Session or configuration state changed during deployment")
    if args.include_server:
        if directory_hash(target / "dist/server") != manifest["serverHash"]:
            raise RuntimeError("Published backend differs from verified build")
    elif backend != hashlib.sha256((target / "dist/server/index.js").read_bytes()).hexdigest():
        raise RuntimeError("Backend unexpectedly changed")
    public = urllib.request.urlopen(args.origin + "/", timeout=30).read()
    if public != (source / "dist/web/index.html").read_bytes():
        raise RuntimeError("Public entry does not match verified build")
    public_manifest = request("/release-manifest.json")
    if public_manifest != manifest:
        raise RuntimeError("Public release manifest mismatch")
    assets = json.loads((source / "dist/web/.vite/manifest.json").read_text())
    entry = next(row for row in assets.values() if row.get("isEntry"))
    verified = {}
    for path in [entry["file"], *entry.get("css", [])]:
        payload = urllib.request.urlopen(args.origin + "/" + path, timeout=30).read()
        if payload != (source / "dist/web" / path).read_bytes():
            raise RuntimeError("Public asset mismatch: " + path)
        verified[path] = hashlib.sha256(payload).hexdigest()
    result = {"source": manifest["source"], "webHash": manifest["webHash"], "url": args.origin, "ready": ready,
        "dataUnchanged": True, "databaseMigration": args.database_migration, "previousDatabaseVersion": previous_version,
        "historicalModes": "work" if args.database_migration == "session-modes-v18" else "unchanged", "tables": tables, "serverUnchanged": not args.include_server, "serverHash": manifest.get("serverHash"), "previousServerIndexHash": backend, "backup": str(backup), "assets": verified, "retainedAssets": retained}
    pathlib.Path(args.evidence).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
except Exception:
    if swapped:
        systemctl("stop")
        (target / "dist/web").rename(target / ".data" / ("failed-web-" + release))
        old.rename(target / "dist/web")
        if server_swapped:
            (target / "dist/server").rename(target / ".data" / ("failed-server-" + release))
            server_old.rename(target / "dist/server")
        if args.database_migration:
            restore_database(backup / "database.sqlite", target / ".data/newbot.sqlite")
    if stopped:
        systemctl("start")
    raise
finally:
    try:
        request("/api/agent/action", {"action": "bridge/maintenance", "enabled": False})
    except Exception:
        pass
