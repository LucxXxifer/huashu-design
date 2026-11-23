#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath


def digest(data):
    return hashlib.sha256(data).hexdigest()


def add_file(source, relative, destinations, files):
    path = PurePosixPath(relative)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in relative.split("/")):
        raise ValueError(f"unsafe package path: {relative!r}")
    source_path = Path(source)
    if source_path.is_symlink() or not source_path.is_file():
        raise ValueError(f"package source must be a regular, non-symlink file: {source_path}")
    data = source_path.read_bytes()
    destination = destinations.joinpath(*path.parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    destination.chmod(0o644)
    files[relative] = digest(data)


def build(repository, output):
    repository, output = Path(repository).resolve(), Path(output).resolve()
    if output == repository or repository in output.parents or output in repository.parents:
        raise ValueError("output directory must be separate from the repository root")
    skill = repository / "skills/huashu-design-codex"
    with tempfile.TemporaryDirectory(prefix="huashu-package-") as temporary:
        staging = Path(temporary) / "huashu-design-codex"
        staged_skill = staging / "skills/huashu-design-codex"
        files = {}
        skill_list = skill / "scripts/package-files.txt"
        skill_files = skill_list.read_text(encoding="utf-8").splitlines()
        if len(set(skill_files)) != len(skill_files) or any(
            not name.startswith(("scripts/", "references/", "samples/git-desk/", "assets/"))
            and name not in ("SKILL.md", "LICENSE.upstream") for name in skill_files
        ):
            raise ValueError("Skill package file list contains a duplicate or forbidden path")
        package_sources = [
            (repository / "README.codex.md", "README.codex.md"),
            (skill / "LICENSE.upstream", "LICENSE.upstream"),
            (repository / "codex/package.json", "runtime/package.json"),
            (repository / "codex/package-lock.json", "runtime/package-lock.json"),
            *((skill / name, f"skills/huashu-design-codex/{name}") for name in skill_files),
        ]
        for source, relative in package_sources:
            add_file(source, relative, staging, files)

        skill_text = (staged_skill / "SKILL.md").read_text(encoding="utf-8")
        if "UPSTREAM_SKILL.md" in skill_text or "| 作業 | 讀取 |" not in skill_text:
            raise ValueError("Codex Skill entrypoint is missing or malformed")
        readme = (staging / "README.codex.md").read_text(encoding="utf-8")
        if "LICENSE.upstream" not in readme:
            raise ValueError("Package README does not link its bundled upstream license")

        manifest = [{"path": name, "sha256": checksum} for name, checksum in sorted(files.items())]
        output.mkdir(parents=True, exist_ok=True)
        staged_manifest = staging / "PACKAGE-MANIFEST.json"
        staged_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        staged_manifest.chmod(0o644)
        manifest_temp = output / ".PACKAGE-MANIFEST.json.tmp"
        manifest_temp.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        manifest_temp.replace(output / "PACKAGE-MANIFEST.json")

        archive_temp = output / ".huashu-design-codex.zip.tmp"
        result = subprocess.run(
            ["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(staging), str(archive_temp)],
            check=False, capture_output=True, text=True, timeout=60,
        )
        if result.returncode:
            raise RuntimeError(result.stderr[-1500:] or "ditto failed to build the package")
        archive_manifest = subprocess.run(
            ["/usr/bin/unzip", "-p", str(archive_temp), "huashu-design-codex/PACKAGE-MANIFEST.json"],
            check=True, capture_output=True, timeout=10,
        ).stdout
        if archive_manifest != staged_manifest.read_bytes():
            raise RuntimeError("archive manifest differs from the generated package manifest")
        manifest_temp = output / ".PACKAGE-MANIFEST.json.tmp"
        manifest_temp.write_bytes(archive_manifest)
        manifest_temp.replace(output / "PACKAGE-MANIFEST.json")
        with archive_temp.open("rb") as stream:
            os.fsync(stream.fileno())
        archive_temp.replace(output / "huashu-design-codex.zip")

        sha_file = output / "SHA256SUMS"
        sums = subprocess.run(["/usr/bin/shasum", "-a", "256", str(output / "huashu-design-codex.zip")], check=True, capture_output=True, text=True, timeout=10)
        line = sums.stdout.rstrip("\n")
        sha_file.write_text(line.split()[0] + "  huashu-design-codex.zip\n", encoding="ascii")
        print(f"Packaged {len(files)} allowlisted files: {output / 'huashu-design-codex.zip'}")
        print(line)


def main():
    if len(sys.argv) != 3:
        print("Usage: build-release-archive.py <repository-root> <output-directory>", file=sys.stderr)
        return 2
    try:
        build(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Release archive build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
