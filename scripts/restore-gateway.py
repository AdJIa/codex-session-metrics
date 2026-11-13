#!/usr/bin/env python3
"""Restore the gateway URL configured by pre-0.1.7 timing proxy installers."""
import json, os, pathlib, re, sys, tomllib, subprocess
home = pathlib.Path(os.environ.get('CODEX_HOME', pathlib.Path.home() / '.codex'))
state_path = home / 'session-metrics' / 'timing-install.json'
if not state_path.exists():
    print('No legacy timing proxy installation found.')
    sys.exit(0)
state = json.loads(state_path.read_text())
config = home / 'config.toml'
text = config.read_text()
provider = state['provider']
current = tomllib.loads(text).get('model_providers', {}).get(provider, {}).get('base_url')
if current == state['proxy_url']:
    section = re.compile(r'(?m)^\[model_providers\.' + re.escape(provider) + r'\]\s*$(.*?)(?=^\[|\Z)', re.S | re.M)
    match = section.search(text)
    if not match:
        raise RuntimeError('Provider table not found; no configuration was changed')
    body, count = re.subn(r'(?m)^(base_url\s*=\s*)' + re.escape(json.dumps(state['proxy_url'])) + r'(\s*(?:#.*)?)$', lambda m: m[1] + json.dumps(state['upstream']) + m[2], match[1])
    if count != 1:
        raise RuntimeError('Could not safely match base_url; no configuration was changed')
    updated = text[:match.start(1)] + body + text[match.end(1):]
    tomllib.loads(updated)
    temporary = state_path.parent / 'config.restore.tmp'
    temporary.write_text(updated)
    temporary.chmod(0o600)
    os.replace(temporary, config)
elif current != state['upstream']:
    raise RuntimeError('Provider URL has changed; leaving configuration and proxy untouched')
state['enabled'] = False
state_path.write_text(json.dumps(state, indent=2))
if state.get('launch_agent'):
    subprocess.run(['launchctl', 'bootout', 'gui/' + str(os.getuid()) + '/' + state['launch_agent']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
print('Original gateway URL restored and proxy auto-start disabled. Restart Codex to apply.')
