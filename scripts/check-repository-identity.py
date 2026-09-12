import json, os, re, subprocess
from pathlib import Path
from urllib.parse import urlsplit

CANONICAL = 'caaaptaintop/newsnow'
root = branch = identity = 'unknown'
status = ''
reason = 'identity check failed'
passed = False

def git(*args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_TRACE')}
    env['GIT_OPTIONAL_LOCKS'] = '0'
    result = subprocess.run(['git', *args], capture_output=True, text=True, env=env, timeout=10)
    if result.returncode != 0:
        raise ValueError('git check failed')
    return result.stdout.rstrip('\n')

def normalize(raw):
    if any(c.isspace() or ord(c) < 32 for c in raw) or any(c in raw for c in '%?#\\'):
        raise ValueError('unsupported URL')
    if raw.startswith(('https://', 'ssh://')):
        url = urlsplit(raw)
        if url.scheme == 'https':
            if url.username is not None or url.password is not None:
                raise ValueError('userinfo not allowed')
        elif url.scheme == 'ssh':
            if url.username != 'git' or url.password is not None:
                raise ValueError('unsupported SSH identity')
        host = url.netloc.rsplit('@', 1)[-1]
        if host != 'github.com' or url.query or url.fragment:
            raise ValueError('unsupported host')
        path = url.path.removeprefix('/')
    elif raw.startswith('git@github.com:'):
        path = raw[len('git@github.com:'):]
    else:
        raise ValueError('unsupported URL')
    path = path.removesuffix('.git')
    if not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*', path):
        raise ValueError('ambiguous repository path')
    return path

try:
    root = git('rev-parse', '--show-toplevel')
    branch = git('branch', '--show-current')
    status = git('status', '--short')
    fetch_urls = git('remote', 'get-url', '--all', 'origin').splitlines()
    push_urls = git('remote', 'get-url', '--push', '--all', 'origin').splitlines()
    if len(fetch_urls) != 1 or len(push_urls) != 1:
        raise ValueError('ambiguous origin')
    fetch_id, push_id = normalize(fetch_urls[0]), normalize(push_urls[0])
    if fetch_id != push_id:
        raise ValueError('fetch/push identity mismatch')
    identity = fetch_id
    expected_root = os.environ.get('NEWSNOW_EXPECTED_ROOT', '')
    if identity != CANONICAL:
        reason = 'repository identity mismatch; fail-closed'
    elif not expected_root or not Path(expected_root).is_absolute():
        reason = 'expected root missing; fail-closed'
    elif Path(root).resolve() != Path(expected_root).resolve():
        reason = 'repository root mismatch; fail-closed'
    else:
        passed, reason = True, 'PASS'
except Exception:
    reason = 'identity unavailable or ambiguous; fail-closed'

report = dict(repo_root=root, repository_identity=identity, branch=branch,
              expected_repository_identity=CANONICAL, reason=reason)
if passed:
    report['status'] = status
print(json.dumps(report, ensure_ascii=False))
raise SystemExit(0 if passed else 1)
