"""Safe local file operations.

All filesystem access is confined to an allow-list of roots (the application
data directory plus any explicitly user-selected directories). Paths are
resolved and checked so that ``..`` traversal and symlink escapes are rejected.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path

MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MiB import ceiling


class FileError(ValueError):
    """Raised for rejected or failed file operations."""


class PathNotAllowed(FileError):
    pass


class FileTooLarge(FileError):
    pass


def _resolved(path: Path) -> Path:
    # strict=False so we can validate paths that do not exist yet.
    return Path(os.path.realpath(str(path)))


class FileManager:
    def __init__(self, data_dir: Path):
        self.data_dir = _resolved(Path(data_dir))
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._extra_roots: set[Path] = set()

    # -- roots -------------------------------------------------------------

    def allow_root(self, path: str | Path) -> Path:
        """Register an additional user-selected directory as an allowed root."""
        root = _resolved(Path(path))
        if not root.is_dir():
            raise FileError(f"Not a directory: {path}")
        self._extra_roots.add(root)
        return root

    def allowed_roots(self) -> list[Path]:
        return [self.data_dir, *sorted(self._extra_roots)]

    def is_allowed(self, path: str | Path) -> bool:
        target = _resolved(Path(path))
        for root in self.allowed_roots():
            if target == root or root in target.parents:
                return True
        return False

    def require_allowed(self, path: str | Path) -> Path:
        target = _resolved(Path(path))
        if not self.is_allowed(target):
            raise PathNotAllowed(f"Path is outside the permitted directories: {path}")
        return target

    # -- names -------------------------------------------------------------

    @staticmethod
    def safe_filename(name: str, default: str = "file") -> str:
        """Return a filesystem-safe basename (no directories, no traversal)."""
        if not name:
            return default
        base = os.path.basename(name.replace("\\", "/")).strip()
        base = base.lstrip(".") or default
        cleaned = "".join(c for c in base if c.isalnum() or c in " ._-()[]")
        cleaned = cleaned.strip() or default
        return cleaned[:128]

    # -- reading / writing -------------------------------------------------

    def read_text(self, path: str | Path, max_bytes: int = MAX_FILE_BYTES) -> str:
        target = self.require_allowed(path)
        if not target.is_file():
            raise FileError(f"File not found: {path}")
        size = target.stat().st_size
        if size > max_bytes:
            raise FileTooLarge(f"File exceeds {max_bytes} bytes: {path}")
        return target.read_text(encoding="utf-8", errors="replace")

    def read_bytes(self, path: str | Path, max_bytes: int = MAX_FILE_BYTES) -> bytes:
        target = self.require_allowed(path)
        if not target.is_file():
            raise FileError(f"File not found: {path}")
        if target.stat().st_size > max_bytes:
            raise FileTooLarge(f"File exceeds {max_bytes} bytes: {path}")
        return target.read_bytes()

    def write_text(self, path: str | Path, text: str, *, overwrite: bool = True) -> Path:
        target = self.require_allowed(path)
        if target.exists() and not overwrite:
            raise FileError(f"Refusing to overwrite existing file: {target.name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write via temp file in the same directory.
        fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".luka-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(text)
            os.replace(tmp, target)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return target

    def write_bytes(self, path: str | Path, data: bytes, *, overwrite: bool = True) -> Path:
        target = self.require_allowed(path)
        if target.exists() and not overwrite:
            raise FileError(f"Refusing to overwrite existing file: {target.name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".luka-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, target)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return target

    def delete(self, path: str | Path) -> None:
        target = self.require_allowed(path)
        if target.is_file():
            target.unlink()
        elif target.is_dir():
            shutil.rmtree(target)

    def list_dir(self, path: str | Path) -> list[dict]:
        target = self.require_allowed(path)
        if not target.is_dir():
            raise FileError(f"Not a directory: {path}")
        entries = []
        for entry in sorted(target.iterdir(), key=lambda p: (p.is_dir(), p.name.lower())):
            try:
                stat = entry.stat()
            except OSError:
                continue
            entries.append(
                {
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size,
                }
            )
        return entries


def content_hash(data: bytes | str) -> str:
    """Stable content hash used for de-duplicating imports."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()
