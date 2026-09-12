"""Offline integration coverage for the repository identity gate."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check-repository-identity.py'
CANONICAL = 'https://github.com/caaaptaintop/newsnow.git'


class RepositoryIdentityTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='newsnow-identity-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / 'repo'
        self.root.mkdir()
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith('GIT_') and k != 'NEWSNOW_EXPECTED_ROOT'}
        self.env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
        self.git('init', '--initial-branch=main')
        self.git('remote', 'add', 'origin', CANONICAL)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, env=self.env,
                              capture_output=True, text=True, check=True).stdout

    def gate(self, expected=None, cwd=None, extra_env=None):
        env = self.env.copy()
        env['NEWSNOW_EXPECTED_ROOT'] = str(self.root if expected is None else expected)
        env.update(extra_env or {})
        result = subprocess.run([sys.executable, str(SCRIPT)], cwd=cwd or self.root,
                                env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.stderr, '', 'gate must not leak Git diagnostics')
        report = json.loads(result.stdout)
        self.assertEqual(report['expected_repository_identity'], 'caaaptaintop/newsnow')
        return result.returncode, report, result.stdout

    def test_supported_remote_forms(self):
        for url in [CANONICAL, CANONICAL.removesuffix('.git'),
                    'ssh://git@github.com/caaaptaintop/newsnow.git',
                    'git@github.com:caaaptaintop/newsnow.git']:
            with self.subTest(url=url):
                self.git('remote', 'set-url', 'origin', url)
                code, report, _ = self.gate()
                self.assertEqual(code, 0)
                self.assertEqual(report['reason'], 'PASS')
                self.assertEqual(report['repository_identity'], 'caaaptaintop/newsnow')

    def test_rejected_remote_forms(self):
        urls = [
            'https://github.com/another-owner/newsnow.git',
            'https://github.com/caaaptaintop/another-repo.git',
            'https://github.example/caaaptaintop/newsnow.git',
            'https://github.com:443/caaaptaintop/newsnow.git',
            'http://github.com/caaaptaintop/newsnow.git',
            'git@github-alias:caaaptaintop/newsnow.git',
            'ssh://fixture-user@github.com/caaaptaintop/newsnow.git',
            'ssh://git:fixture-password@github.com/caaaptaintop/newsnow.git',
            'https://fixture-user@github.com/caaaptaintop/newsnow.git',
            'https://fixture-user:fixture-password@github.com/caaaptaintop/newsnow.git',
            CANONICAL + '?fixture-secret', CANONICAL + '#fixture-secret',
            CANONICAL + '/extra', CANONICAL + '/', CANONICAL + ' ',
            'https://github.com/caaaptaintop%2Fnewsnow.git',
        ]
        for url in urls:
            with self.subTest(url=url):
                self.git('remote', 'set-url', 'origin', url)
                code, report, output = self.gate()
                self.assertEqual(code, 1)
                self.assertNotIn('status', report)
                self.assertNotIn(url, output)
                for secret in ['fixture-user', 'fixture-password', 'fixture-secret']:
                    self.assertNotIn(secret, output)

    def test_explicit_root_required(self):
        for expected in ['', '.', self.root.parent / 'wrong-root']:
            with self.subTest(expected=expected):
                code, report, _ = self.gate(expected=expected)
                self.assertEqual(code, 1)
                self.assertNotIn('status', report)
        self.env.pop('NEWSNOW_EXPECTED_ROOT', None)
        result = subprocess.run([sys.executable, str(SCRIPT)], cwd=self.root,
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['reason'], 'expected root missing; fail-closed')

    def test_push_identity_and_multiplicity(self):
        self.git('config', 'remote.origin.pushurl', 'https://github.com/another-owner/newsnow.git')
        self.assertEqual(self.gate()[0], 1)
        self.git('config', 'remote.origin.pushurl', CANONICAL)
        self.assertEqual(self.gate()[0], 0)
        self.git('config', '--add', 'remote.origin.pushurl', CANONICAL)
        self.assertEqual(self.gate()[0], 1)

    def test_multiple_fetch_urls_are_rejected(self):
        self.git('config', '--add', 'remote.origin.url', CANONICAL)
        self.assertEqual(self.gate()[0], 1)

    def test_missing_origin_and_non_repository(self):
        self.git('remote', 'remove', 'origin')
        self.assertEqual(self.gate()[0], 1)
        self.assertEqual(self.gate(cwd=self.root.parent)[0], 1)

    def test_linked_worktree_and_resolved_path(self):
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '--allow-empty', '-m', 'fixture')
        worktree = self.root.parent / 'task'
        self.git('worktree', 'add', '-b', 'codex/fixture', str(worktree))
        self.assertEqual(self.gate(expected=worktree, cwd=worktree)[0], 0)
        self.assertEqual(self.gate(expected=self.root, cwd=worktree)[0], 1)
        alias = self.root.parent / 'alias'
        alias.symlink_to(worktree, target_is_directory=True)
        self.assertEqual(self.gate(expected=alias, cwd=worktree)[0], 0)

    def test_read_only_with_dirty_files_and_trace_disabled(self):
        (self.root / 'keep.txt').write_text('unrelated local work\n')

        def snapshot():
            return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in self.root.rglob('*') if p.is_file()}

        before = snapshot()
        code, report, output = self.gate(extra_env={'GIT_TRACE': '1', 'GIT_TRACE_SETUP': '1'})
        self.assertEqual(code, 0)
        self.assertIn('keep.txt', report['status'])
        self.assertNotIn(CANONICAL, output)
        self.assertEqual(snapshot(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
