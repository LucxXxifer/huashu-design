#!/usr/bin/env python3
"""Classify a stable upstream release without executing its code or installing its dependencies."""

import argparse
import ast
import html
import json
from pathlib import Path
import re
import subprocess


SKILL = 'skills/huashu-design-codex'
SHA = re.compile(r'[0-9a-f]{40}')
TAG = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
SKILL_VERSION = re.compile(r'(?m)^(  version: )"?([0-9]+\.[0-9]+\.[0-9]+)"?$')
MAX_BLOB = 1024 * 1024


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True, timeout=45).stdout


def blob(repo, sha, name):
    ref = f'{sha}:{name}'
    if int(git(repo, 'cat-file', '-s', ref)) > MAX_BLOB:
        raise ValueError('Source file is too large for automatic comparison.')
    return git(repo, 'cat-file', 'blob', ref).decode('utf-8')


def version(tag):
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError(f'Expected a stable vMAJOR.MINOR.PATCH tag: {tag!r}')
    return tuple(map(int, match.groups()))


def version_only_md(before, after, base, target):
    def without_version(text, expected):
        frontmatter = text.split('---\n', 2)
        if len(frontmatter) != 3 or frontmatter[0]:
            return None
        versions = SKILL_VERSION.findall(frontmatter[1])
        if versions != [('  version: ', expected)]:
            return None
        frontmatter[1] = SKILL_VERSION.sub(r'\g<1><version>', frontmatter[1])
        return frontmatter
    first = without_version(before, base)
    return first is not None and first == without_version(after, target)


def version_only_json(name, before, after, base, target):
    def without_version(source, expected):
        data = json.loads(source)
        if data.get('name') != 'huashu-design' or data.get('version') != expected:
            return None
        data['version'] = '<version>'
        if name == 'package-lock.json':
            root = data.get('packages', {}).get('')
            if not isinstance(root, dict) or root.get('version') != expected:
                return None
            root['version'] = '<version>'
        return data
    first = without_version(before, base)
    return first is not None and first == without_version(after, target)


def compare_asset(args, name, before, after):
    target = args.candidate / SKILL / name
    if not target.is_file() or target.is_symlink():
        return {'reason': 'The Codex package does not contain the expected regular component file.'}
    for sha in (args.base_commit, args.commit):
        mode = git(args.upstream, 'ls-tree', sha, '--', name).split(b' ', 1)[0]
        if mode != b'100644':
            return {'reason': 'The upstream component is no longer a regular non-executable file.'}
    payload = json.dumps({'before': before, 'after': after, 'installed': target.read_text(encoding='utf-8')})
    result = subprocess.run(['node', str(Path(__file__).with_name('sync-asset.cjs'))], input=payload,
                            capture_output=True, text=True, timeout=20)
    if result.returncode:
        return {'reason': 'The JSX could not be compared with the locked Babel parser.'}
    return json.loads(result.stdout)


def classify(args, policy, status, name):
    item = {'path': name, 'git_status': status, 'decision': 'review', 'reason': ''}
    equivalent = policy['shared_jsx'].get(name) or policy['python_replacements'].get(name)
    if equivalent:
        item['equivalent'] = equivalent
    if name in policy['reference_only'] or name.startswith('scripts/tests/'):
        return {**item, 'decision': 'report-only', 'reason': 'Upstream documentation or tests. The Codex package uses its own entry and fixtures.'}, None
    if status != 'M':
        return {**item, 'reason': 'A file was added, removed or changed type. Map its capability before packaging.'}, None
    reason = policy['review_notes'].get(name, 'No compatible automatic rule matches. Review the upstream change before packaging.')
    try:
        if name in policy['shared_jsx'] or name in policy['python_replacements'] or name in ('SKILL.md', 'package.json', 'package-lock.json'):
            before = blob(args.upstream, args.base_commit, name)
            after = blob(args.upstream, args.commit, name)
        if name in policy['shared_jsx']:
            result = compare_asset(args, name, before, after)
            if 'code' in result:
                return {**item, 'decision': 'sync-asset', 'reason': 'Equivalent JSX structure with compatible styling or formatting changes.'}, result['code']
            reason = result['reason']
        elif name in policy['python_replacements']:
            if ast.dump(ast.parse(before, type_comments=True)) == ast.dump(ast.parse(after, type_comments=True)):
                return {**item, 'decision': 'keep-adaptation', 'reason': 'Python structure is unchanged. Retain the existing Codex equivalent.'}, None
            reason = 'Python behavior changed. Extend the listed Codex equivalent and its output tests as needed.'
        elif (name == 'SKILL.md' and version_only_md(before, after, args.base_tag[1:], args.tag[1:])
              or name in ('package.json', 'package-lock.json') and version_only_json(name, before, after, args.base_tag[1:], args.tag[1:])):
            return {**item, 'decision': 'keep-adaptation', 'reason': 'Only upstream version metadata changed. Preserve Codex instructions and dependencies.'}, None
    except (ValueError, SyntaxError, subprocess.CalledProcessError):
        reason = 'Could not verify the source contents or format for automatic reuse.'
    return {**item, 'reason': reason}, None


def update_metadata(args):
    paths = ('README.codex.md', f'{SKILL}/SKILL.md', f'{SKILL}/references/upstream.md', f'{SKILL}/references/miniprogram.md')
    prepared = {}
    for name in paths:
        file = args.candidate / name
        before = file.read_text(encoding='utf-8')
        if args.base_commit not in before:
            raise ValueError(f'The recorded baseline is missing from {name}.')
        after = before.replace(args.base_commit, args.commit)
        if name.endswith('SKILL.md'):
            field = f'upstream-version: "{args.base_tag[1:]}"'
            if before.count(field) != 1:
                raise ValueError('The Skill version metadata does not match the policy baseline.')
            after = after.replace(field, f'upstream-version: "{args.tag[1:]}"')
        elif name.endswith('README.codex.md') or name.endswith('upstream.md'):
            after = re.sub(r'(?<![\d.])' + re.escape(args.base_tag[1:]) + r'(?![\d.])', args.tag[1:], after)
        prepared[file] = after
    return prepared


def write_audit(folder, report):
    folder.mkdir(parents=True, exist_ok=False)
    (folder / 'upstream-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    rows = [
        '# Huashu 上游相容性檢查', '',
        f"上游 `{report['upstream']['tag']}` · `{report['upstream']['commit']}`",
        f"審計基準 `{report['baseline']['tag']}` · `{report['baseline']['commit']}`",
        f"結果 **{report['status']}**。已分類 {len(report['changes'])} 個異動檔。", '',
    ]
    for problem in report['problems']:
        rows.append(f'- {html.escape(problem)}')
    if report['changes']:
        rows.extend(['', '| 檔案 | 處理方式 | 原因及 Codex 對應 |', '|---|---|---|'])
        for item in report['changes']:
            name = html.escape(json.dumps(item['path'], ensure_ascii=True)[1:-1]).replace('|', '&#124;')
            detail = html.escape(item['reason'] + ' ' + item.get('equivalent', '')).strip().replace('|', '&#124;')
            rows.append(f"| <code>{name}</code> | {item['decision']} | {detail} |")
    (folder / 'upstream-audit.md').write_text('\n'.join(rows) + '\n', encoding='utf-8')


def prepare(args):
    policy = json.loads(args.policy.read_bytes())
    if policy.get('schema') != 1:
        raise ValueError('Unsupported compatibility policy schema.')
    args.base_tag = policy['baseline']['tag']
    args.base_commit = policy['baseline']['commit']
    if not SHA.fullmatch(args.base_commit) or not SHA.fullmatch(args.commit):
        raise ValueError('Expected full Git commit SHA values.')
    base_ver, target_ver = version(args.base_tag), version(args.tag)
    for commit in {args.base_commit, args.commit}:
        if git(args.upstream, 'rev-parse', '--verify', f'{commit}^{{commit}}').strip().decode() != commit:
            raise ValueError('Upstream commit does not resolve to the expected object.')
    report = {'schema': 1, 'baseline': policy['baseline'], 'upstream': {'tag': args.tag, 'commit': args.commit},
              'status': 'ready', 'problems': [], 'changes': []}
    if target_ver < base_ver or (target_ver == base_ver) != (args.commit == args.base_commit):
        report['problems'].append('The stable tag is older than the baseline, reused at a different commit, or points to the wrong commit.')
    raw = git(args.upstream, 'diff', '--name-status', '--no-renames', '--no-ext-diff', '--no-textconv', '-z', args.base_commit, args.commit, '--')
    fields = raw[:-1].decode('utf-8', errors='surrogateescape').split('\0') if raw else []
    copies = {}
    for status, name in zip(fields[0::2], fields[1::2], strict=True):
        item, code = classify(args, policy, status, name)
        report['changes'].append(item)
        if code is not None:
            copies[args.candidate / SKILL / name] = code
    if report['problems'] or any(item['decision'] == 'review' for item in report['changes']):
        report['status'] = 'needs-review'
    elif args.commit != args.base_commit:
        for file, text in (copies | update_metadata(args)).items():
            file.write_text(text, encoding='utf-8')
    write_audit(args.report, report)
    print(f"{args.tag} {args.commit} · {report['status']} · {len(report['changes'])} changed file(s)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    command = sub.add_parser('prepare')
    for name in ('policy', 'candidate', 'upstream', 'report'):
        command.add_argument(f'--{name}', type=Path, required=True)
    command.add_argument('--tag', required=True)
    command.add_argument('--commit', required=True)
    args = parser.parse_args()
    try:
        prepare(args)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Upstream check failed: {error}\n')


if __name__ == '__main__':
    main()
