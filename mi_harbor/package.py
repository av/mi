"""Helpers for packaging the local mi checkout for Harbor eval containers."""

from __future__ import annotations

import hashlib
import io
import gzip
import tarfile
from pathlib import Path


PACKAGE_PATHS = ("index.mjs", "package.json", "README.md", "tools", "skills")


def local_package_archive(root: Path | None = None) -> tuple[bytes, str] | None:
    root = root or Path(__file__).parent.parent
    if not (root / "index.mjs").exists():
        return None

    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tar:
        for path in _package_files(root):
            info = tar.gettarinfo(path, arcname=path.relative_to(root).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            with path.open("rb") as file:
                tar.addfile(info, file)

    archive = io.BytesIO()
    with gzip.GzipFile(fileobj=archive, mode="wb", mtime=0) as gz:
        gz.write(raw.getvalue())

    data = archive.getvalue()
    return data, hashlib.sha256(data).hexdigest()


def _package_files(root: Path) -> list[Path]:
    files = []
    for name in PACKAGE_PATHS:
        path = root / name
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(p for p in path.rglob("*") if p.is_file())
    return sorted(files, key=lambda p: p.relative_to(root).as_posix())
