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

parser = argparse.ArgumentParser(description="Publish an already verified web build; retain backend, database and tunnel configuration.")
parser.add_argument("--target", required=True)
parser.add_argument("--origin", required=True)
parser.add_argument("--receipt", required=True)
parser.add_argument("--service", required=True)
parser.add_argument("--evidence", required=True)
args = parser.parse_args()
source = pathlib.Path(__file__).resolve().parents[1]
target = pathlib.Path(args.target).resolve()
receipt = pathlib.Path(args.receipt).resolve()
subprocess.run(["node", "--import", "tsx", "scripts/verify-release.ts", "dist/web", str(receipt)], cwd=source, check=True)
manifest = json.loads((source / "dist/web/release-manifest.json").read_text())
release = manifest["source"][:12]
backup = target / ".data/backups" / (time.strftime("%Y-%m-%d-web-") + release)
backup.mkdir(mode=0o700, parents=True)
stage = target / ".data" / ("staged-web-" + release)
old = target / ".data" / ("previous-web-" + release)
if stage.exists() or old.exists():
    raise RuntimeError("Release staging already exists; inspect it before retrying")
shutil.copytree(source / "dist/web", stage)
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
tables = ["threads", "session_runtime", "session_runtime_pending", "thread_workspaces", "plugin_connection_settings", "private_field_sets", "provider_configuration"]
def summaries(connection):
    return {table: {"count": connection.execute("select count(*) from " + table).fetchone()[0],
        "sha256": hashlib.sha256(json.dumps(connection.execute("select * from " + table + " order by 1").fetchall(), default=str).encode()).hexdigest()} for table in tables}
def systemctl(action):
    subprocess.run(["systemctl", "--user", action, args.service], check=True)
swapped = False
try:
    with sqlite3.connect(target / ".data/newbot.sqlite") as connection:
        with sqlite3.connect(backup / "database.sqlite") as saved:
            connection.backup(saved)
        before = summaries(connection)
    (backup / "baseline.json").write_text(json.dumps(before))
    shutil.copytree(target / "dist/web", backup / "web")
    backend = hashlib.sha256((target / "dist/server/index.js").read_bytes()).hexdigest()
    systemctl("stop")
    (target / "dist/web").rename(old)
    try:
        stage.rename(target / "dist/web")
    except Exception:
        old.rename(target / "dist/web")
        systemctl("start")
        raise
    swapped = True
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
    with sqlite3.connect("file:" + str(target / ".data/newbot.sqlite") + "?mode=ro", uri=True) as connection:
        after = summaries(connection)
    if before != after:
        raise RuntimeError("Session or configuration state changed during deployment")
    if backend != hashlib.sha256((target / "dist/server/index.js").read_bytes()).hexdigest():
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
        "dataUnchanged": True, "tables": tables, "serverUnchanged": True, "backup": str(backup), "assets": verified, "retainedAssets": retained}
    pathlib.Path(args.evidence).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
except Exception:
    if swapped:
        systemctl("stop")
        (target / "dist/web").rename(target / ".data" / ("failed-web-" + release))
        old.rename(target / "dist/web")
        systemctl("start")
    raise
finally:
    try:
        request("/api/agent/action", {"action": "bridge/maintenance", "enabled": False})
    except Exception:
        pass
