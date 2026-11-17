#!/usr/bin/env python3
"""Explicit offline cleanup of one Newbot instance; requires an existing private backup."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def tables(db):
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def clear_tables(db, selected):
    all_tables = tables(db)
    selected = set(selected) & all_tables
    parents = {t: {r[2] for r in db.execute('PRAGMA foreign_key_list(' + quote(t) + ')')} for t in all_tables}
    while True:
        expanded = selected | {t for t in all_tables if parents[t] & selected}
        if expanded == selected:
            break
        selected = expanded
    counts = {t: db.execute('SELECT count(*) FROM ' + quote(t)).fetchone()[0] for t in sorted(selected)}
    db.execute('PRAGMA defer_foreign_keys=ON')
    for t in selected:
        db.execute('DELETE FROM ' + quote(t))
    assert not db.execute('PRAGMA foreign_key_check').fetchall(), 'Foreign key violation'
    return counts


def fingerprint(db, table):
    rows = db.execute('SELECT * FROM ' + quote(table) + ' ORDER BY rowid').fetchall()
    return hashlib.sha256(repr(rows).encode()).hexdigest()


def reset(data):
    data = data.resolve(strict=True)
    native = data / 'codex'
    assert native.resolve() == native and not native.is_symlink(), 'Codex directory must be isolated'
    assert data != Path.home() and data != Path.home()/'.codex' and data not in (Path('/'), Path.home().parent)
    assert (data/'newbot.sqlite').is_file() and (native/'state_5.sqlite').is_file()
    report = {'data': str(data), 'databases': {}, 'filesRemoved': []}
    app = sqlite3.connect(data/'newbot.sqlite')
    app.execute('PRAGMA foreign_keys=ON')
    preserved = ['provider_configuration','plugin_connection_settings','private_field_sets','managed_credentials','experts','extension_configuration','extension_packages','automation_event_accounts','automation_mail_config']
    before = {t: fingerprint(app,t) for t in preserved}
    workspaces = [Path(r[0]) for r in app.execute('SELECT root FROM thread_workspaces WHERE legacy=0')]
    upload_ids = {r[0] for r in app.execute('SELECT file_id FROM run_attachments UNION SELECT file_id FROM automation_attachment_refs')}
    with app:
        report['databases']['newbot.sqlite'] = clear_tables(app, {'threads','runs','automation_tasks','automation_event_webhooks','automation_webhook_inbox','automation_incoming_credentials'})
        for prefix in ['thread-ui:','tool-display:','turn-failure:','followups:']:
            app.execute('DELETE FROM metadata WHERE key LIKE ?', (prefix+'%',))
        app.execute("DELETE FROM extension_resource_refs WHERE owner LIKE 'thread:%' OR owner LIKE 'run:%' OR owner LIKE 'pending-thread:%'")
        for file_id in upload_ids:
            app.execute('DELETE FROM attachments WHERE id=?',(file_id,))
        app.execute('DELETE FROM private_operations')
        assert not app.execute('PRAGMA foreign_key_check').fetchall()
        assert before == {t: fingerprint(app,t) for t in preserved}, 'Configuration changed'
    report['configurationPreserved'] = True
    app.execute('PRAGMA wal_checkpoint(TRUNCATE)');app.close()
    for p in sorted(native.glob('*.sqlite')):
        db = sqlite3.connect(p);db.execute('PRAGMA foreign_keys=ON')
        selected = {t for t in tables(db) if t=='threads' or any(r[1] in ('thread_id','parent_thread_id','child_thread_id') for r in db.execute('PRAGMA table_info('+quote(t)+')'))}
        with db:
            report['databases']['codex/'+p.name] = clear_tables(db,selected)
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()
    p=data/'event-subscriptions/subscriptions.sqlite'
    if p.exists():
        db=sqlite3.connect(p);db.execute('PRAGMA foreign_keys=ON')
        with db: report['databases']['event-subscriptions/subscriptions.sqlite']=clear_tables(db,tables(db))
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()
    paths=[native/n for n in ['sessions','archived_sessions','session_index.jsonl','history.jsonl','shell_snapshots','thread-writer-locks']]
    for path in workspaces:
        if path.is_relative_to(data/'workspaces'):
            paths.append(path)
    paths += [data/'uploads'/file_id for file_id in upload_ids]
    for path in paths:
        if not path.exists(): continue
        assert path.resolve().is_relative_to(data) and not path.is_symlink(), 'Unsafe history path'
        report['filesRemoved'].append(str(path.relative_to(data)))
        if path.is_dir():shutil.rmtree(path)
        else:path.unlink()
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',required=True,type=Path)
    parser.add_argument('--backup',required=True,type=Path)
    parser.add_argument('--report',required=True,type=Path)
    args=parser.parse_args()
    assert (args.backup/'newbot.sqlite').is_file() and (args.backup/'codex/state_5.sqlite').is_file(), 'Backup missing'
    assert args.data.resolve()!=args.backup.resolve(), 'Never operate on backup'
    result=reset(args.data)
    args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cleared':True,'configurationPreserved':result['configurationPreserved'],'appThreads':result['databases']['newbot.sqlite'].get('threads',0),'nativeThreads':result['databases']['codex/state_5.sqlite'].get('threads',0),'tasks':result['databases']['newbot.sqlite'].get('automation_tasks',0)}))
