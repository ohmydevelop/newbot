import datetime
import json
import os
import pathlib
import sqlite3
import threading
import urllib.parse
import urllib.request
import uuid

_lock = threading.Lock()
_worker = None
_db = None
_settings = None


def normalize(event_type, context):
    types = {"agent:start": "hermes.agent.started", "agent:end": "hermes.agent.completed", "session:reset": "hermes.session.reset"}
    if event_type not in types:
        return None
    data = {key: str(context[key])[:500] for key in ("platform", "session_id", "chat_id", "thread_id") if context.get(key) is not None}
    for key in ("message", "response"):
        if isinstance(context.get(key), str):
            data[key] = context[key][:1000]
    return types[event_type], data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Relay redirect refused")


def _start():
    global _db, _settings, _worker
    url, token, source, directory = [os.environ["NEWBOT_EVENT_" + key] for key in ("URL", "TOKEN", "SOURCE", "OUTBOX")]
    parsed = urllib.parse.urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not (parsed.scheme == "https" or parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")):
        raise ValueError("Relay requires HTTPS or loopback")
    pathlib.Path(directory).mkdir(mode=0o700, parents=True, exist_ok=True)
    path = pathlib.Path(directory) / "outbox.sqlite"
    _db = sqlite3.connect(path, check_same_thread=False)
    os.chmod(path, 0o600)
    _db.execute("PRAGMA journal_mode=WAL")
    _db.execute("CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, body TEXT NOT NULL)")
    _db.commit()
    _settings = (url, token, source)
    _worker = threading.Thread(target=_loop, daemon=True)
    _worker.start()


def flush():
    with _lock:
        rows = _db.execute("SELECT id,body FROM outbox ORDER BY rowid LIMIT 32").fetchall()
    url, token, _ = _settings
    opener = urllib.request.build_opener(NoRedirect())
    for event_id, body in rows:
        request = urllib.request.Request(url, data=body.encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
        with opener.open(request, timeout=10) as response:
            if response.status < 200 or response.status >= 300:
                raise ValueError("Relay did not accept event")
        with _lock:
            _db.execute("DELETE FROM outbox WHERE id=?", (event_id,))
            _db.commit()


def _loop():
    wait = threading.Event()
    while not wait.wait(5):
        try:
            flush()
        except Exception:
            pass


async def handle(event_type, context):
    normalized = normalize(event_type, context)
    if normalized is None:
        return
    with _lock:
        if _db is None:
            _start()
        event_id = str(uuid.uuid4())
        event = {"specversion": "1.0", "id": event_id, "source": _settings[2], "type": normalized[0], "time": datetime.datetime.now(datetime.timezone.utc).isoformat(), "datacontenttype": "application/json", "data": normalized[1]}
        if _db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] >= 10000:
            raise ValueError("Newbot event outbox full")
        _db.execute("INSERT INTO outbox VALUES(?,?)", (event_id, json.dumps(event)))
        _db.commit()
