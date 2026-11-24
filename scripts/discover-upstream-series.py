#!/usr/bin/env python3
"""Resolve every supported stable GitHub Release from the adapter baseline to Latest."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


STABLE = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
NUMERIC = re.compile(r'v([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?(?:[-+].*)?')
REPO = 'repos/alchaincyf/huashu-design'
MAX_STABLE_RELEASES = 200


def version(tag):
    match = STABLE.fullmatch(tag)
    if not match:
        raise ValueError(f'Unsupported stable release tag format: {tag!r}')
    return tuple(map(int, match.groups()))


def select_series(releases, latest_tag, baseline_tag, baseline_commit, resolve_commit):
    """Return a verified, strictly increasing stable release series including both ends."""
    baseline_version = version(baseline_tag)
    latest_version = version(latest_tag)
    if latest_version < baseline_version:
        raise ValueError('Latest stable release is older than the policy baseline.')
    if not isinstance(releases, list):
        raise ValueError('GitHub Releases response must be an array.')

    by_tag = {}
    for release in releases:
        if not isinstance(release, dict) or not isinstance(release.get('tag_name'), str):
            raise ValueError('Every GitHub Release needs a tag_name.')
        tag = release['tag_name']
        if tag in by_tag:
            raise ValueError(f'Duplicate GitHub Release tag: {tag}')
        by_tag[tag] = release

    latest = by_tag.get(latest_tag)
    if not latest or latest.get('draft') or latest.get('prerelease'):
        raise ValueError('The official Latest tag is missing or not a stable published release.')
    baseline = by_tag.get(baseline_tag)
    if not baseline or baseline.get('draft') or baseline.get('prerelease'):
        raise ValueError('The policy baseline release is missing or not a stable published release.')

    stable = []
    for tag, release in by_tag.items():
        if release.get('draft') or release.get('prerelease'):
            continue
        match = STABLE.fullmatch(tag)
        if not match:
            numeric = NUMERIC.fullmatch(tag)
            if numeric:
                parts = tuple(int(part or 0) for part in numeric.groups())
                if baseline_version <= parts <= latest_version:
                    raise ValueError(f'A non-standard stable tag falls inside the adapter range: {tag}')
            continue
        stable.append((tuple(map(int, match.groups())), tag))

    if not stable or max(item[0] for item in stable) != latest_version:
        raise ValueError('The official Latest release is not the newest stable semver Release.')
    stable.sort()
    if len({item[0] for item in stable}) != len(stable):
        raise ValueError('Duplicate semantic versions use different stable release tags.')
    selected = [(ver, tag) for ver, tag in stable if baseline_version <= ver <= latest_version]
    if not selected or selected[0] != (baseline_version, baseline_tag) or selected[-1] != (latest_version, latest_tag):
        raise ValueError('The complete stable series does not contain the exact baseline and Latest endpoints.')
    if len(selected) > MAX_STABLE_RELEASES:
        raise ValueError(f'The stable release series exceeds the {MAX_STABLE_RELEASES}-release safety bound.')

    result = []
    for _, tag in selected:
        commit = resolve_commit(tag)
        if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{40}', commit):
            raise ValueError(f'GitHub did not resolve {tag} to a full commit SHA.')
        if tag == baseline_tag and commit != baseline_commit:
            raise ValueError('The upstream baseline tag resolves to a different commit than the policy baseline.')
        result.append({'tag': tag, 'commit': commit})
    return result


def api(path, token):
    request = Request(f'https://api.github.com/{path}', headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
    })
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def main():
    token = os.environ['GH_TOKEN']
    repository = f'repos/{os.environ["GITHUB_REPOSITORY"]}'
    latest = api(f'{REPO}/releases/latest', token)
    policy = json.loads(Path('codex/upstream-policy.json').read_bytes())
    baseline = policy['baseline']

    releases = []
    for page in range(1, 101):
        page_items = api(f'{REPO}/releases?per_page=100&page={page}', token)
        if not isinstance(page_items, list):
            raise ValueError('GitHub Releases page was not an array.')
        releases.extend(page_items)
        if len(page_items) < 100:
            break
    else:
        raise ValueError('GitHub Releases exceeded the 100-page safety bound.')

    latest_tag = latest.get('tag_name')
    series = select_series(
        releases, latest_tag, baseline['tag'], baseline['commit'],
        lambda tag: api(f'{REPO}/commits/{quote(tag, safe="")}', token)['sha'],
    )
    adapter = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', adapter):
        raise ValueError('GitHub did not return a full adapter commit hash.')

    upstream = series[-1]['commit']
    latest_row = releases[next(index for index, row in enumerate(releases) if row['tag_name'] == latest_tag)]
    date = (latest_row.get('published_at') or '')[:10]
    release = f'huashu-codex-{latest_tag}-{upstream[:12]}-{adapter[:12]}'
    try:
        existing = api(f'{repository}/releases/tags/{release}', token)
    except HTTPError as error:
        if error.code != 404:
            raise
        existing = None
    if existing:
        required = {'huashu-design-codex.zip', 'SHA256SUMS', 'PACKAGE-MANIFEST.json', 'upstream-audit.json', 'upstream-audit.md', 'BUILD-PROVENANCE.json'}
        uploaded = {asset['name'] for asset in existing['assets'] if asset['state'] == 'uploaded' and asset['size'] > 0}
        if existing['draft'] or existing['prerelease'] or not required <= uploaded:
            raise ValueError('An incomplete Release already holds this tag. Inspect its assets before retrying.')
        if api(f'{repository}/commits/{release}', token)['sha'] != adapter:
            raise ValueError('The existing Release tag points to a different Codex commit.')

    output_path = Path(os.environ['GITHUB_OUTPUT'])
    with output_path.open('a', encoding='utf-8') as output:
        delimiter = 'HUASHU_RELEASE_SERIES'
        series_json = json.dumps(series, separators=(',', ':'))
        if delimiter in series_json:
            raise ValueError('Unexpected delimiter collision in release series.')
        output.write(f'series<<{delimiter}\n{series_json}\n{delimiter}\n')
        for key, value in dict(tag=latest_tag, date=date, upstream=upstream,
                               adapter=adapter, release=release, build=str(existing is None).lower()).items():
            output.write(f'{key}={value}\n')
    with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a', encoding='utf-8') as summary:
        summary.write(f'Upstream `{latest_tag}` · `{upstream}` · published {date}\n\n')
        summary.write(f'Codex source `{adapter}`\n\n')
        summary.write(f'Verified stable series: {" → ".join(item["tag"] for item in series)}\n\n')
        if existing:
            summary.write(f'[{release}]({existing["html_url"]}) already contains the verified bundle.\n')


if __name__ == '__main__':
    try:
        main()
    except (KeyError, ValueError, OSError) as error:
        sys.exit(f'Upstream release discovery failed: {error}')
