#!/usr/bin/env python3
"""Enable/disable the local timing proxy without touching API credentials."""
import os,sys,json,re,pathlib,subprocess,time,shutil,socket,tomllib,plistlib
root=pathlib.Path(__file__).resolve().parent.parent
home=pathlib.Path(os.environ.get('CODEX_HOME',pathlib.Path.home()/'.codex'))
data=home/'session-metrics';data.mkdir(exist_ok=True,mode=0o700)
config=home/'config.toml';state=data/'timing-install.json'
label='local.codex-session-metrics';domain='gui/'+str(os.getuid());plist=data/(label+'.plist')
def replace_url(text,provider,old,new):
    # Limit mutation to the selected provider's simple table and exact URL value.
    section=re.compile(r'(?m)^\[model_providers\.'+re.escape(provider)+r'\]\s*$(.*?)(?=^\[|\Z)',re.S|re.M)
    m=section.search(text)
    if not m:raise RuntimeError('Selected provider table not found; configuration was not changed')
    body=m.group(1)
    pat=re.compile(r'(?m)^(base_url\s*=\s*)'+re.escape(json.dumps(old))+r'(\s*(?:#.*)?)$')
    body,n=pat.subn(lambda a:a.group(1)+json.dumps(new)+a.group(2),body)
    if n!=1:raise RuntimeError('Could not safely match base_url; configuration was not changed')
    out=text[:m.start(1)]+body+text[m.end(1):];tomllib.loads(out);return out
def save(text):
    tmp=data/'config.new';tmp.write_text(text);tmp.chmod(0o600);os.replace(tmp,config)
if '--disable' in sys.argv:
    s=json.loads(state.read_text());text=config.read_text();save(replace_url(text,s['provider'],s['proxy_url'],s['upstream']))
    s['enabled']=False;state.write_text(json.dumps(s,indent=2))
    if s.get('launch_agent'):subprocess.run(['launchctl','bootout',domain+'/'+label],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    else:
        try:os.kill(s['pid'],15)
        except ProcessLookupError:pass
    print('Restored upstream URL; timing proxy stopped. Restart Codex to apply.')
else:
    text=config.read_text();cfg=tomllib.loads(text);provider=cfg.get('model_provider');p=cfg.get('model_providers',{}).get(provider,{})
    upstream=p.get('base_url');proxy='http://127.0.0.1:43188/v1'
    if upstream==proxy:print('Timing proxy is already configured.');sys.exit(0)
    if not upstream:raise RuntimeError('Selected custom provider has no base_url')
    # Check conflict before starting or editing configuration.
    with socket.socket() as sock:sock.bind(('127.0.0.1',43188))
    new=replace_url(text,provider,upstream,proxy)
    node=shutil.which('node')
    if not node:raise RuntimeError('Node.js is required')
    proxy_program=root/'dist/proxy.mjs'
    # launchd supervises the process across app restarts. Plist stays inside CODEX_HOME.
    spec={'Label':label,'ProgramArguments':[node,str(proxy_program)],'EnvironmentVariables':{'CODEX_HOME':str(home),'METRICS_UPSTREAM':upstream,'METRICS_PROXY_PORT':'43188'},'KeepAlive':True,'RunAtLoad':True,'StandardOutPath':str(data/'proxy.log'),'StandardErrorPath':str(data/'proxy.log')}
    plist.write_bytes(plistlib.dumps(spec));plist.chmod(0o600)
    registered=subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
    proc=None
    if not registered:
        log=open(data/'proxy.log','ab')
        proc=subprocess.Popen([node,str(proxy_program)],env={**os.environ,'CODEX_HOME':str(home),'METRICS_UPSTREAM':upstream,'METRICS_PROXY_PORT':'43188'},stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    ready=False
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1',43188),timeout=.2):ready=True;break
        except OSError:time.sleep(.1)
    if not ready:
        if registered:subprocess.run(['launchctl','bootout',domain+'/'+label],check=False)
        elif proc:proc.terminate()
        raise RuntimeError('Proxy did not start; configuration was not changed')
    backup=data/('config-before-timing-'+str(int(time.time()))+'.toml');backup.write_text(text);backup.chmod(0o600)
    try:save(new)
    except Exception:
        if registered:subprocess.run(['launchctl','bootout',domain+'/'+label],check=False)
        elif proc:proc.terminate()
        raise
    state.write_text(json.dumps({'enabled':True,'provider':provider,'upstream':upstream,'proxy_url':proxy,'launch_agent':label if registered else None,'pid':proc.pid if proc else None,'backup':str(backup)},indent=2));state.chmod(0o600)
    print('Timing proxy enabled on 127.0.0.1:43188. Restart Codex to apply. Disable: python3 scripts/timing.py --disable')
