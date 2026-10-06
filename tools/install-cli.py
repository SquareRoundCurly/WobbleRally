"""Install the pinned PocketRealms wheel without cloud or monorepo access."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

lock = json.loads((Path(__file__).resolve().parents[1] / 'toolchain.json').read_text())['cli']
filename = f"pocketrealms-{lock['version']}-py3-none-any.whl"
with urllib.request.urlopen('https://pocketrealms.ai/sdk/' + filename, timeout=30) as response:
    data = response.read(2 * 1024 * 1024)
if hashlib.sha256(data).hexdigest() != lock['sha256']:
    raise SystemExit('CLI distribution checksum failed')
with tempfile.TemporaryDirectory() as directory:
    wheel = Path(directory) / filename
    wheel.write_bytes(data)
    subprocess.run([sys.executable, '-m', 'pip', 'install', str(wheel)], check=True)
