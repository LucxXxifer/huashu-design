import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / 'scripts/sync-upstream.py'
POLICY = REPO / 'codex/upstream-policy.json'
SKILL = Path('skills/huashu-design-codex')
BASE = '937113133ae446a69ea19d4ceed6cbd2ed3c7735'
FRAME = 'assets/wechat_frame.jsx'


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.PIPE).strip().decode()


class UpstreamSyncTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='huashu-upstream-test-')
        self.addCleanup(self.scratch.cleanup)
        self.temp = Path(self.scratch.name)
        self.upstream = self.temp / 'upstream'
        self.upstream.mkdir()
        git(self.upstream, 'init', '-q')
        git(self.upstream, 'config', 'user.name', 'Huashu fixture')
        git(self.upstream, 'config', 'user.email', 'fixture@example.invalid')
        self.frame = 'function WechatFrame(){return <main data-mp-page="pages/home/home" style={{color:"#112233",padding:20}}>Home</main>}\n'
        self.write(FRAME, self.frame)
        self.write('SKILL.md', '---\nname: huashu-design\nmetadata:\n  version: "3.5.0"\n---\n# Stable instructions\n')
        self.write('scripts/mp_handoff.py', 'def pages():\n    return ["pages/home/home"]\n')
        self.base = self.commit('baseline')
        self.tag('v3.5.0', self.base)
        self.candidate = self.temp / 'candidate'
        self.candidate.mkdir()
        (self.candidate / SKILL / 'assets').mkdir(parents=True)
        (self.candidate / SKILL / FRAME).write_text(self.frame)
        for name in ['SKILL.md', 'references/upstream.md', 'references/miniprogram.md']:
            src = REPO / SKILL / name
            dst = self.candidate / SKILL / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes().replace(BASE.encode(), self.base.encode()))
        (self.candidate / 'README.codex.md').write_bytes((REPO / 'README.codex.md').read_bytes().replace(BASE.encode(), self.base.encode()))
        policy = json.loads(POLICY.read_bytes())
        policy['baseline']['commit'] = self.base
        self.policy = self.temp / 'policy.json'
        self.policy.write_text(json.dumps(policy))

    def write(self, path, text):
        path = self.upstream / path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, message):
        git(self.upstream, 'add', '.')
        git(self.upstream, 'commit', '-qm', message)
        return git(self.upstream, 'rev-parse', 'HEAD')

    def tag(self, name, commit):
        existing = subprocess.run(['git', '-C', str(self.upstream), 'rev-parse', '--verify',
                                   f'refs/tags/{name}^{{commit}}'], capture_output=True, text=True)
        if existing.returncode == 0:
            self.assertEqual(existing.stdout.strip(), commit)
            return
        git(self.upstream, 'tag', name, commit)

    def prepare(self, commit, version='3.5.1'):
        self.tag(f'v{version}', commit)
        report = self.temp / 'audit'
        proc = subprocess.run([sys.executable, str(SCRIPT), 'prepare', '--policy', str(self.policy),
                               '--candidate', str(self.candidate), '--upstream', str(self.upstream),
                               '--tag', f'v{version}', '--commit', commit, '--report', str(report)],
                              env={**os.environ, 'HUASHU_NODE_MODULES': os.environ.get('HUASHU_NODE_MODULES') or str(REPO / 'codex/node_modules')},
                              text=True, capture_output=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        return json.loads((report / 'upstream-audit.json').read_bytes())

    def test_updates_allowed_style_and_keeps_existing_codex_replacement(self):
        self.write(FRAME, '// upstream prose\n' + self.frame.replace('#112233', '#abcdef').replace('padding:20', 'padding:24'))
        self.write('scripts/mp_handoff.py', '# comment only\ndef pages():\n    return ["pages/home/home"]\n')
        skill_path = self.upstream / 'SKILL.md'
        skill_path.write_text(skill_path.read_text().replace('3.5.0', '3.5.1'))
        sha = self.commit('styles and version')
        report = self.prepare(sha)
        self.assertEqual(report['status'], 'ready')
        decisions = {item['path']: item['decision'] for item in report['changes']}
        self.assertEqual(decisions, {FRAME: 'sync-asset', 'SKILL.md': 'keep-adaptation', 'scripts/mp_handoff.py': 'keep-adaptation'})
        frame = (self.candidate / SKILL / FRAME).read_text()
        self.assertIn('#abcdef', frame)
        self.assertIn('padding: 24', frame)
        self.assertNotIn('upstream prose', frame)
        self.assertIn('upstream-version: "3.5.1"', (self.candidate / SKILL / 'SKILL.md').read_text())
        self.assertIn(sha, (self.candidate / SKILL / 'references/miniprogram.md').read_text())

    def test_holds_unknown_code_and_changed_contract_without_writing_candidate(self):
        self.write(FRAME, self.frame.replace('data-mp-page', 'data-new-page'))
        self.write('scripts/mp_handoff.py', 'def pages():\n    return ["pages/start/start"]\n')
        self.write('scripts/new_feature.py', 'raise RuntimeError("this source must never run")\n')
        report = self.prepare(self.commit('new contract'))
        self.assertEqual(report['status'], 'needs-review')
        self.assertEqual({item['path'] for item in report['changes'] if item['decision'] == 'review'}, {FRAME, 'scripts/mp_handoff.py', 'scripts/new_feature.py'})
        self.assertTrue(next(item for item in report['changes'] if item['path'] == 'scripts/mp_handoff.py')['equivalent'])
        self.assertEqual((self.candidate / SKILL / FRAME).read_text(), self.frame)
        self.assertIn('upstream-version: "3.5.0"', (self.candidate / SKILL / 'SKILL.md').read_text())

    def test_holds_removed_asset_and_tag_mismatch(self):
        (self.upstream / FRAME).unlink()
        self.write('README.md', 'Hi\n')
        commit = self.commit('remove exported component')
        report = self.prepare(commit)
        self.assertEqual(report['status'], 'needs-review')
        self.assertEqual(next(item['decision'] for item in report['changes'] if item['path'] == FRAME), 'review')

    def test_baseline_build_is_ready_without_rewriting(self):
        report = self.prepare(self.base, '3.5.0')
        self.assertEqual(report['status'], 'ready')
        self.assertEqual(report['changes'], [])
        self.assertEqual((self.candidate / SKILL / FRAME).read_text(), self.frame)

    def test_series_audits_each_release_and_applies_only_ready_steps(self):
        installed_bin = self.candidate / 'codex/node_modules/.bin/playwright-core'
        installed_bin.parent.mkdir(parents=True)
        installed_bin.symlink_to('../playwright-core/cli.js')
        self.write(FRAME, self.frame.replace('#112233', '#abcdef'))
        self.write('SKILL.md', (self.upstream / 'SKILL.md').read_text().replace('3.5.0', '3.5.1'))
        first = self.commit('first compatible release')
        self.tag('v3.5.1', first)

        self.write(FRAME, self.frame.replace('#112233', '#abcdef').replace('padding:20', 'padding:24'))
        self.write('SKILL.md', (self.upstream / 'SKILL.md').read_text().replace('3.5.1', '3.5.2'))
        second = self.commit('second compatible release')
        self.tag('v3.5.2', second)

        series = self.temp / 'series.json'
        series.write_text(json.dumps([
            {'tag': 'v3.5.0', 'commit': self.base},
            {'tag': 'v3.5.1', 'commit': first},
            {'tag': 'v3.5.2', 'commit': second},
        ]))
        report = self.temp / 'series-audit'
        proc = subprocess.run([
            sys.executable, str(SCRIPT), 'prepare-series', '--policy', str(self.policy),
            '--candidate', str(self.candidate), '--upstream', str(self.upstream),
            '--series', str(series), '--report', str(report),
        ], env={**os.environ, 'HUASHU_NODE_MODULES': os.environ.get('HUASHU_NODE_MODULES') or str(REPO / 'codex/node_modules')},
            text=True, capture_output=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        audit = json.loads((report / 'upstream-audit.json').read_bytes())
        self.assertEqual(audit['status'], 'ready')
        self.assertEqual([item['upstream']['tag'] for item in audit['releases']], ['v3.5.0', 'v3.5.1', 'v3.5.2'])
        self.assertEqual([item['status'] for item in audit['releases']], ['ready', 'ready', 'ready'])
        self.assertEqual([item['baseline']['tag'] for item in audit['releases']], ['v3.5.0', 'v3.5.0', 'v3.5.1'])
        self.assertIn('本版比較基準 `v3.5.1`', (report / 'upstream-audit.md').read_text())
        self.assertEqual(audit['upstream']['commit'], second)
        frame = (self.candidate / SKILL / FRAME).read_text()
        self.assertIn('#abcdef', frame)
        self.assertIn('padding: 24', frame)
        self.assertIn(second, (self.candidate / SKILL / 'references/miniprogram.md').read_text())
        self.assertTrue(installed_bin.is_symlink())
        self.assertEqual(os.readlink(installed_bin), '../playwright-core/cli.js')

    def test_series_stops_before_publishing_after_unknown_release(self):
        self.write('scripts/new_feature.py', 'raise RuntimeError("this source must never run")\n')
        first = self.commit('unknown release')
        self.tag('v3.5.1', first)
        self.write(FRAME, self.frame.replace('#112233', '#abcdef'))
        second = self.commit('later compatible release')
        self.tag('v3.5.2', second)
        series = self.temp / 'series.json'
        series.write_text(json.dumps([
            {'tag': 'v3.5.0', 'commit': self.base},
            {'tag': 'v3.5.1', 'commit': first},
            {'tag': 'v3.5.2', 'commit': second},
        ]))
        report = self.temp / 'series-audit'
        proc = subprocess.run([
            sys.executable, str(SCRIPT), 'prepare-series', '--policy', str(self.policy),
            '--candidate', str(self.candidate), '--upstream', str(self.upstream),
            '--series', str(series), '--report', str(report),
        ], env={**os.environ, 'HUASHU_NODE_MODULES': os.environ.get('HUASHU_NODE_MODULES') or str(REPO / 'codex/node_modules')},
            text=True, capture_output=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        audit = json.loads((report / 'upstream-audit.json').read_bytes())
        self.assertEqual(audit['status'], 'needs-review')
        self.assertEqual([item['upstream']['tag'] for item in audit['releases']], ['v3.5.0', 'v3.5.1'])
        self.assertEqual(audit['releases'][1]['status'], 'needs-review')
        self.assertEqual((self.candidate / SKILL / FRAME).read_text(), self.frame)
        self.assertIn('upstream-version: "3.5.0"', (self.candidate / SKILL / 'SKILL.md').read_text())

    def test_series_updates_version_metadata_when_a_release_reuses_its_commit(self):
        repeated = self.temp / 'series.json'
        self.tag('v3.5.1', self.base)
        self.write(FRAME, self.frame.replace('#112233', '#abcdef'))
        next_commit = self.commit('changed after metadata-only release')
        self.tag('v3.5.2', next_commit)
        repeated.write_text(json.dumps([
            {'tag': 'v3.5.0', 'commit': self.base},
            {'tag': 'v3.5.1', 'commit': self.base},
            {'tag': 'v3.5.2', 'commit': next_commit},
        ]))
        report = self.temp / 'series-audit'
        proc = subprocess.run([
            sys.executable, str(SCRIPT), 'prepare-series', '--policy', str(self.policy),
            '--candidate', str(self.candidate), '--upstream', str(self.upstream),
            '--series', str(repeated), '--report', str(report),
        ], env={**os.environ, 'HUASHU_NODE_MODULES': os.environ.get('HUASHU_NODE_MODULES') or str(REPO / 'codex/node_modules')},
            text=True, capture_output=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        audit = json.loads((report / 'upstream-audit.json').read_bytes())
        self.assertEqual(audit['status'], 'ready')
        self.assertEqual(audit['releases'][1]['changes'], [])
        skill = (self.candidate / SKILL / 'SKILL.md').read_text()
        self.assertIn('upstream-version: "3.5.2"', skill)
        self.assertIn(next_commit, skill)

    def test_series_rejects_tag_commit_mismatch(self):
        self.write(FRAME, self.frame.replace('#112233', '#abcdef'))
        actual = self.commit('release tag target')
        self.write('different.txt', 'different commit\n')
        wrong = self.commit('different commit')
        self.tag('v3.5.1', actual)
        self.tag('v3.5.2', wrong)
        series = self.temp / 'wrong-tag.json'
        series.write_text(json.dumps([
            {'tag': 'v3.5.0', 'commit': self.base},
            {'tag': 'v3.5.1', 'commit': wrong},
        ]))
        report = self.temp / 'wrong-tag-audit'
        proc = subprocess.run([
            sys.executable, str(SCRIPT), 'prepare-series', '--policy', str(self.policy),
            '--candidate', str(self.candidate), '--upstream', str(self.upstream),
            '--series', str(series), '--report', str(report),
        ], env={**os.environ, 'HUASHU_NODE_MODULES': os.environ.get('HUASHU_NODE_MODULES') or str(REPO / 'codex/node_modules')},
            text=True, capture_output=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        audit = json.loads((report / 'upstream-audit.json').read_bytes())
        self.assertEqual(audit['status'], 'needs-review')
        self.assertIn('tag', audit['releases'][1]['problems'][0].lower())
        self.assertEqual((self.candidate / SKILL / FRAME).read_text(), self.frame)


if __name__ == '__main__':
    unittest.main()
