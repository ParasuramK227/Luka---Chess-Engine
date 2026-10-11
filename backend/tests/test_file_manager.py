"""File manager security tests."""

import pytest

from backend.storage.file_manager import FileError, FileManager, PathNotAllowed


def test_write_and_read_within_root(tmp_path):
    fm = FileManager(tmp_path)
    path = tmp_path / "note.txt"
    fm.write_text(path, "hello")
    assert fm.read_text(path) == "hello"


def test_path_traversal_rejected(tmp_path):
    fm = FileManager(tmp_path / "data")
    outside = tmp_path / "secret.txt"
    outside.write_text("secret")
    with pytest.raises(PathNotAllowed):
        fm.read_text(outside)


def test_overwrite_guard(tmp_path):
    fm = FileManager(tmp_path)
    path = tmp_path / "a.txt"
    fm.write_text(path, "one")
    with pytest.raises(FileError):
        fm.write_text(path, "two", overwrite=False)


def test_safe_filename_strips_paths():
    result = FileManager.safe_filename("../../etc/passwd")
    assert "/" not in result
    assert ".." not in result
    assert "/" not in FileManager.safe_filename("a/b/c.pgn")
    assert ".." not in FileManager.safe_filename("../x.pgn")


def test_file_size_limit(tmp_path):
    fm = FileManager(tmp_path)
    path = tmp_path / "big.txt"
    fm.write_text(path, "x" * 100)
    with pytest.raises(FileError):
        fm.read_text(path, max_bytes=10)


def test_allow_root_extends_access(tmp_path):
    data = tmp_path / "data"
    other = tmp_path / "other"
    other.mkdir()
    fm = FileManager(data)
    target = other / "f.txt"
    target.write_text("hi")
    with pytest.raises(PathNotAllowed):
        fm.read_text(target)
    fm.allow_root(other)
    assert fm.read_text(target) == "hi"
