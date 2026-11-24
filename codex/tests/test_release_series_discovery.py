import importlib.util
import json
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/discover-upstream-series.py'
SPEC = importlib.util.spec_from_file_location('discover_upstream_series', SCRIPT)
discovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(discovery)


class ReleaseSeriesDiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.sha = {
            'v3.5.0': 'a' * 40,
            'v3.5.1': 'b' * 40,
            'v3.6.0': 'c' * 40,
        }
        self.releases = [
            {'tag_name': 'v3.6.0', 'draft': False, 'prerelease': False},
            {'tag_name': 'v3.5.2-rc.1', 'draft': False, 'prerelease': True},
            {'tag_name': 'v3.5.1', 'draft': False, 'prerelease': False},
            {'tag_name': 'v2.0', 'draft': False, 'prerelease': False},
            {'tag_name': 'v3.5.0', 'draft': False, 'prerelease': False},
            {'tag_name': 'v3.7.0', 'draft': True, 'prerelease': False},
        ]

    def resolve(self, tag):
        return self.sha[tag]

    def test_returns_every_stable_release_in_semver_order_and_resolves_exact_shas(self):
        result = discovery.select_series(self.releases, 'v3.6.0', 'v3.5.0', self.sha['v3.5.0'], self.resolve)
        self.assertEqual(result, [
            {'tag': 'v3.5.0', 'commit': self.sha['v3.5.0']},
            {'tag': 'v3.5.1', 'commit': self.sha['v3.5.1']},
            {'tag': 'v3.6.0', 'commit': self.sha['v3.6.0']},
        ])

    def test_rejects_a_missing_baseline_release(self):
        releases = [item for item in self.releases if item['tag_name'] != 'v3.5.0']
        with self.assertRaisesRegex(ValueError, 'baseline'):
            discovery.select_series(releases, 'v3.6.0', 'v3.5.0', self.sha['v3.5.0'], self.resolve)

    def test_rejects_an_unlisted_or_non_newest_latest_release(self):
        with self.assertRaisesRegex(ValueError, '(?i)latest'):
            discovery.select_series(self.releases, 'v3.5.1', 'v3.5.0', self.sha['v3.5.0'], self.resolve)

    def test_rejects_a_newer_stable_tag_outside_the_supported_version_format(self):
        releases = self.releases + [{'tag_name': 'v3.05.3', 'draft': False, 'prerelease': False}]
        with self.assertRaisesRegex(ValueError, 'non-standard'):
            discovery.select_series(releases, 'v3.6.0', 'v3.5.0', self.sha['v3.5.0'], self.resolve)

    def test_rejects_duplicate_tags_and_semver_aliases(self):
        duplicate = self.releases + [{'tag_name': 'v3.5.1', 'draft': False, 'prerelease': False}]
        with self.assertRaisesRegex(ValueError, '(?i)duplicate'):
            discovery.select_series(duplicate, 'v3.6.0', 'v3.5.0', self.sha['v3.5.0'], self.resolve)
        alias = self.releases + [{'tag_name': 'v3.05.1', 'draft': False, 'prerelease': False}]
        with self.assertRaisesRegex(ValueError, 'non-standard'):
            discovery.select_series(alias, 'v3.6.0', 'v3.5.0', self.sha['v3.5.0'], self.resolve)

    def test_rejects_sha_mismatch_or_unresolved_commit(self):
        with self.assertRaisesRegex(ValueError, 'baseline'):
            discovery.select_series(self.releases, 'v3.6.0', 'v3.5.0', 'd' * 40, self.resolve)
        with self.assertRaisesRegex(ValueError, 'commit'):
            discovery.select_series(self.releases, 'v3.6.0', 'v3.5.0', self.sha['v3.5.0'], lambda tag: 'not-a-sha')


if __name__ == '__main__':
    unittest.main()
