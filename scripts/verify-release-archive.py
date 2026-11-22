#!/usr/bin/env python3
import hashlib
import json
import stat
import sys
import unicodedata
import zipfile
from pathlib import PurePosixPath


MAX_FILE_SIZE = 50 * 1024 * 1024
MAX_TOTAL_SIZE = 200 * 1024 * 1024


def verify(archive_path, manifest_path):
    root = "huashu-design-codex"
    prefix = root + "/"
    with open(manifest_path, encoding="utf-8") as stream:
        manifest = json.load(stream)
    if not isinstance(manifest, list) or not manifest:
        raise ValueError("package manifest must contain at least one path")
    expected = {}
    for item in manifest:
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            raise ValueError("invalid package manifest entry")
        relative = item["path"]
        digest = item["sha256"]
        if (not isinstance(relative, str) or not isinstance(digest, str) or len(digest) != 64
                or any(char not in "0123456789abcdefABCDEF" for char in digest)):
            raise ValueError("invalid package path or SHA-256")
        path = PurePosixPath(relative)
        if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in relative.split("/")):
            raise ValueError(f"unsafe manifest path: {relative!r}")
        if unicodedata.normalize("NFC", relative) != relative or "\\" in relative or "\x00" in relative:
            raise ValueError(f"unsafe manifest path: {relative!r}")
        if relative in expected or relative == "UPSTREAM_SKILL.md" or any(relative.startswith(previous + "/") or previous.startswith(relative + "/") for previous in expected):
            raise ValueError(f"duplicate or conflicting manifest path: {relative!r}")
        expected[relative] = digest.lower()

    expected_directories = {"huashu-design-codex"}
    for relative in expected:
        parts = ("huashu-design-codex", *PurePosixPath(relative).parts[:-1])
        expected_directories.update("/".join(parts[:end]) for end in range(1, len(parts) + 1))

    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    embedded_manifest = None
    with zipfile.ZipFile(archive_path) as package:
        entries = package.infolist()
        files, directories = {}, set()
        for entry in entries:
            name = entry.filename
            if not name.startswith(prefix):
                raise ValueError(f"path outside package root: {name!r}")
            if name == prefix:
                mode = entry.external_attr >> 16
                if not entry.is_dir() or (mode and stat.S_IFMT(mode) not in (0, stat.S_IFDIR)):
                    raise ValueError(f"invalid package root entry: {name!r}")
                if name.rstrip("/") in directories:
                    raise ValueError(f"duplicate directory: {name!r}")
                directories.add(name.rstrip("/"))
                continue
            relative = name[len(prefix):].rstrip("/")
            path = PurePosixPath(relative)
            if (not relative or name.endswith("//") or path.is_absolute() or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
                    or unicodedata.normalize("NFC", name) != name or "\\" in name or "\x00" in name):
                raise ValueError(f"unsafe archive path: {name!r}")
            if entry.flag_bits & 1:
                raise ValueError(f"encrypted archive entry: {name!r}")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError(f"symbolic link entry: {name!r}")
            if entry.is_dir():
                if name.rstrip("/") not in expected_directories:
                    raise ValueError(f"unexpected directory: {name!r}")
                if mode and stat.S_IFMT(mode) not in (0, stat.S_IFDIR):
                    raise ValueError(f"unexpected directory type: {name!r}")
                if relative in directories:
                    raise ValueError(f"duplicate directory: {name!r}")
                directories.add(relative)
                continue
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                raise ValueError(f"unexpected file type: {name!r}")
            if relative in files:
                raise ValueError(f"duplicate file: {name!r}")
            if mode & 0o111:
                raise ValueError(f"unexpected executable file: {name!r}")
            if entry.file_size > MAX_FILE_SIZE:
                raise ValueError(f"unreasonably large file: {name!r}")
            if entry.compress_size and entry.file_size / entry.compress_size > 200:
                raise ValueError(f"unreasonably compressed file: {name!r}")
            if relative == "PACKAGE-MANIFEST.json":
                if embedded_manifest is not None or entry.file_size != len(manifest_bytes):
                    raise ValueError("invalid embedded package manifest")
                embedded_manifest = package.read(entry)
                continue
            files[relative] = entry

        actual, missing = set(files), set(expected) - set(files)
        extra = actual - set(expected)
        if missing or extra:
            raise ValueError(f"package files differ (missing={sorted(missing)}, extra={sorted(extra)})")
        if embedded_manifest != manifest_bytes:
            raise ValueError("embedded package manifest differs from the supplied package manifest")
        total, content = 0, {}
        for relative, entry in files.items():
            data = package.read(entry)
            total += len(data)
            if total > MAX_TOTAL_SIZE:
                raise ValueError("package expands beyond the total size limit")
            actual_digest = hashlib.sha256(data).hexdigest()
            if actual_digest != expected[relative]:
                raise ValueError(f"SHA-256 mismatch for {relative!r}")
            content[relative] = data

    skill = content.get("skills/huashu-design-codex/SKILL.md")
    license_text = content.get("LICENSE.upstream")
    readme = content.get("README.codex.md")
    sample = "skills/huashu-design-codex/samples/git-desk/"
    html = content.get(sample + "commit.html")
    logo = content.get(sample + "assets/git-logo.svg")
    if not skill or b"name: huashu-design-codex" not in skill:
        raise ValueError("Codex Skill entrypoint is missing")
    if not license_text or not readme or b"MIT License" not in license_text or "LICENSE.upstream" not in readme.decode("utf-8"):
        raise ValueError("upstream MIT license or package license link is missing")
    if (not html or not logo or not logo.lstrip().startswith(b"<svg") or b"Jason Long" not in readme
            or b"[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)" not in readme
            or b"Git logo by Jason Long, CC BY 3.0." not in html):
        raise ValueError("Git logo attribution is incomplete")
    if b"Pro Git" not in readme or b"CC BY-NC-SA 3.0" not in readme:
        raise ValueError("Pro Git diagram attribution is incomplete")
    forbidden = {"UPSTREAM_SKILL.md", "node_modules"}
    if any(forbidden.intersection(PurePosixPath(name).parts) for name in files):
        raise ValueError("development-only content may not be repackaged")
    return len(files)


def main():
    if len(sys.argv) != 3:
        print("Usage: verify-release-archive.py <archive.zip> <package-manifest.json>", file=sys.stderr)
        return 2
    try:
        count = verify(sys.argv[1], sys.argv[2])
    except (OSError, UnicodeError, ValueError, TypeError, zipfile.BadZipFile) as error:
        print(f"Release archive rejected: {error}", file=sys.stderr)
        return 1
    print(f"Release archive verified: {count} files match the package manifest and SHA-256 digests; safe paths and license attribution present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
