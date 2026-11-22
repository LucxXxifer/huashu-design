"""Capture three real Git areas in a disposable repo; never touch a user repo."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

output = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix="huashu-git-") as tmp:
    root = Path(tmp)
    env = {
        "PATH": os.environ["PATH"], "HOME": tmp, "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull, "LC_ALL": "C",
        "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
        "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        "GIT_AUTHOR_DATE": "2026-11-21T00:00:00Z", "GIT_COMMITTER_DATE": "2026-11-21T00:00:00Z",
    }

    def git(*args, stdin=None):
        return subprocess.run(["git", *args], cwd=root, env=env, check=True, text=True,
                              input=stdin, capture_output=True, timeout=6).stdout.rstrip("\n")

    git("init", "--quiet", "--template=", "-b", "demo")
    note = root / "field-note.txt"
    note.write_text("Edit the field note.\n")
    git("add", "--", note.name)
    first = git("commit-tree", git("write-tree"), stdin="Field note: base\n")
    git("update-ref", "refs/heads/demo", first)
    note.write_text("Stage the draft.\n")
    git("add", "--", note.name)
    note.write_text("Keep this second edit for later.\n")
    status = git("status", "--short")
    assert status == "MM field-note.txt", status
    shots = [note.read_text().strip(), git("show", ":field-note.txt"), git("show", "HEAD:field-note.txt")]
    evidence = {"version": git("--version"), "status": status, "file": note.name, "working": shots[0],
                "stage": shots[1], "head": shots[2], "workingDiff": git("diff", "--", note.name),
                "indexDiff": git("diff", "--cached", "--", note.name)}
with output.open("x", encoding="utf-8") as handle:
    handle.write("window.GIT_FIXTURE = " + json.dumps(evidence, ensure_ascii=False, indent=2) + ";\n")
