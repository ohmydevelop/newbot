"""Isolated recovery checks. Never signal the real ChatGPT process."""
import json
import os
from pathlib import Path
import runpy
import shutil
import signal
import subprocess
import tempfile
import time

HELPER = '/home/a/.local/bin/chatgpt-supervisor'
UNIT = 'chatgpt-autostart-check.service'
results = []


def record(name, **details):
    result = {'check': name, 'passed': True, **details}
    results.append(result)
    print(json.dumps(result), flush=True)


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def eventually(check, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.2)
    raise AssertionError('Timed out waiting for expected behavior')


with tempfile.TemporaryDirectory(prefix='chatgpt-autostart-check-') as temp:
    root = Path(temp)
    ns = runpy.run_path(HELPER)
    discover = ns['running_instances']
    globals_ = discover.__globals__
    proc = root / 'proc'
    proc.mkdir()
    globals_['PROC'] = proc

    def fixture(pid, args, state='S', executable='/usr/lib/chatgpt/ChatGPT'):
        p = proc / str(pid)
        p.mkdir()
        (p / 'comm').write_text('ChatGPT\n')
        (p / 'exe').symlink_to(executable)
        (p / 'cmdline').write_bytes(args)
        (p / 'stat').write_text(f'{pid} (ChatGPT) {state} 1 1 1')

    fixture(1, b'/usr/lib/chatgpt/ChatGPT\0--ozone-platform=wayland\0')
    fixture(2, b'/usr/lib/chatgpt/ChatGPT --ozone-platform=wayland\0')
    fixture(3, b'/usr/lib/chatgpt/ChatGPT\0--type=renderer\0')
    fixture(4, b'/usr/lib/chatgpt/ChatGPT --type=zygote --flag\0')
    fixture(5, b'/usr/lib/chatgpt/ChatGPT\0', state='Z')
    fixture(6, b'/usr/lib/chatgpt/ChatGPT\0', executable='/tmp/unrelated')
    fixture(7, b'/usr/lib/chatgpt/ChatGPT\0', executable='/usr/lib/chatgpt/ChatGPT (deleted)')
    assert discover() == [1, 2, 7], discover()
    record('main-process boundaries: NUL/flattened argv, renderer, zombie, unrelated binary, updated binary')

    fake = root / 'ChatGPT'
    shutil.copy2('/usr/bin/sleep', fake)
    launcher = root / 'launcher'
    launcher.write_text(f'#!/bin/sh\nexec {fake} 300\n')
    launcher.chmod(0o755)
    harness = root / 'harness.py'
    harness.write_text(
        'import runpy\n'
        f'ns=runpy.run_path({HELPER!r})\n'
        "g=ns['main'].__globals__\n"
        f"g['EXECUTABLE']={str(fake)!r}\n"
        f"g['LAUNCHER']={str(launcher)!r}\n"
        "g['POLL_SECONDS']=0.1\n"
        "raise SystemExit(ns['main']())\n"
    )
    globals_['PROC'] = Path('/proc')
    globals_['EXECUTABLE'] = str(fake)
    preexisting = subprocess.Popen([str(fake), '300'])
    try:
        eventually(lambda: discover() == [preexisting.pid])
        command('systemd-run', '--user', '--quiet', '--collect', f'--unit={UNIT}',
                '--property=Type=exec', '--property=Restart=always',
                '--property=RestartSec=10', '--property=StartLimitIntervalSec=0',
                '--property=OOMPolicy=stop', '/usr/bin/python3', str(harness))
        eventually(lambda: 'Watching existing ChatGPT' in command('journalctl', '--user', '-u', UNIT, '-o', 'cat', '--no-pager'))
        assert discover() == [preexisting.pid]
        record('adopts an existing process without duplicate launch or interruption', pid=preexisting.pid)

        command('systemctl', '--user', 'start', UNIT)
        assert discover() == [preexisting.pid]
        record('repeated start remains a singleton')

        preexisting.kill()
        preexisting.wait()
        recovered = eventually(lambda: discover())
        assert len(recovered) == 1 and recovered[0] != preexisting.pid
        record('recovers after an externally launched process dies', new_pid=recovered[0])

        os.kill(recovered[0], signal.SIGKILL)
        restarted = eventually(lambda: (pids if len(pids := discover()) == 1 and pids[0] != recovered[0] else None))
        restarts = int(command('systemctl', '--user', 'show', UNIT, '-p', 'NRestarts', '--value'))
        assert restarts >= 1
        record('systemd restarts after child SIGKILL', new_pid=restarted[0], restarts=restarts)

        # SIGTERM is a clean/intentional exit; Restart=always must still recover.
        os.kill(restarted[0], signal.SIGTERM)
        after_quit = eventually(lambda: (pids if len(pids := discover()) == 1 and pids[0] != restarted[0] else None))
        record('keep-running policy also recovers after termination', new_pid=after_quit[0])

        command('systemctl', '--user', 'stop', UNIT)
        eventually(lambda: not discover())
        time.sleep(11)
        assert not discover()
        record('explicit service stop stays stopped beyond the restart delay')
    finally:
        subprocess.run(['systemctl', '--user', 'stop', UNIT], capture_output=True)
        if preexisting.poll() is None:
            preexisting.terminate()
        preexisting.wait()
        for pid in discover():
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        subprocess.run(['systemctl', '--user', 'reset-failed', UNIT], capture_output=True)

Path(__file__).with_name('checks.json').write_text(json.dumps(results, indent=2) + '\n')
print('All isolated checks passed. The actual ChatGPT application was not restarted.', flush=True)
