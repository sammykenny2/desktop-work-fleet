"""SPEC-006 DO: why the local data couldn't be opened, and setting a damaged database aside.

Setting aside moves the database, its journals and its local key into a dated folder inside the data folder and never
deletes anything; a failed move puts back what it moved, and a put-back that fails too reports data-set-aside-incomplete,
after which nothing may open the data folder. Preferences, window placement and logs stay where they are.
Pure Python, no GTK or fcntl, so the rules are tested anywhere."""
import errno
import os
import sqlite3
from pathlib import Path

import protocol as p

DAMAGED, FULL, IN_USE, DENIED, KEY, UNREADABLE = "data-damaged", "data-full", "data-in-use", "data-denied", "data-key", "data-unreadable"
CAUSES = (DAMAGED, FULL, IN_USE, DENIED, KEY, UNREADABLE)
# The key file belongs with the database it encrypts, so both move together.
DATABASE_FILES = ("fleet.sqlite3", "fleet.sqlite3-wal", "fleet.sqlite3-shm", "fleet.sqlite3-journal", "storage-key")
SET_ASIDE_PREFIX = "set-aside-"
# The text.py key that explains each cause in the host's own dialog.
TEXT_KEYS = {DAMAGED: "dataFailure.damaged", FULL: "dataFailure.full", IN_USE: "dataFailure.inUse", DENIED: "dataFailure.denied",
             KEY: "dataFailure.key", UNREADABLE: "dataFailure.unreadable"}
MESSAGES = {
    DAMAGED: "The local data is damaged and can't be opened.",
    FULL: "The disk is full, so the local data can't be opened. Free some space and start Work Fleet again.",
    IN_USE: "Another program is using the local data. Close it and start Work Fleet again.",
    DENIED: "Work Fleet isn't allowed to open its local data folder.",
    KEY: "The local key can't verify the local data.",
    UNREADABLE: "The local data can't be opened.",
}


def classify(error):
    """The cause of an error raised while opening the local data, or None when it is no data failure."""
    if isinstance(error, p.Failure):
        # A key that can't verify the data (storage-integrity) keeps its own message: it may only mean the keyring holds
        # another key or another program holds the data, so starting again isn't offered for it.
        return error.code if error.code in CAUSES else None
    if isinstance(error, sqlite3.DatabaseError):
        text = str(error).lower()
        if "not a database" in text or "malformed" in text:
            return DAMAGED
        if "disk is full" in text or "database or disk is full" in text:
            return FULL
        if "locked" in text or "busy" in text:
            return IN_USE
        if "readonly" in text or "unable to open" in text or "permission" in text:
            return DENIED
        return UNREADABLE
    if isinstance(error, OSError):
        if error.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)):
            return FULL
        if error.errno in (errno.EACCES, errno.EPERM, errno.EROFS):
            return DENIED
        return UNREADABLE
    return None


def failure(cause):
    return p.Failure(cause, MESSAGES[cause])


def can_set_aside(cause):
    """Starting with empty data helps only data shown to be damaged or unverifiable: never a full disk, held files or a
    closed folder, and not a cause it can't tell, which could be healthy data from a newer version."""
    return cause in (DAMAGED, KEY)


def set_aside(directory, now):
    """Moves the database files into a new dated folder inside the data folder and returns that folder."""
    directory = Path(directory)
    present = [directory / name for name in DATABASE_FILES if (directory / name).exists()]
    p.require(bool(present), "data-set-aside", "There is no local data to set aside.")
    folder = directory / (SET_ASIDE_PREFIX + now.strftime("%Y%m%d-%H%M%S"))
    p.require(not folder.exists(), "data-set-aside", "The local data was just set aside. Wait a moment and try again.")
    moved = []
    try:
        folder.mkdir(mode=0o700)
        for source in present:
            target = folder / source.name
            os.rename(source, target)
            moved.append((source, target))
        return folder
    except OSError as error:
        restored = True
        for source, target in reversed(moved):
            try:
                os.rename(target, source)
            except OSError:
                restored = False
        try:
            folder.rmdir()
        except OSError:
            pass
        if not restored:
            raise p.Failure("data-set-aside-incomplete", f"Part of the local data is in {folder}. Nothing was deleted; move those files back before starting Work Fleet again.") from error
        raise p.Failure("data-set-aside", "The local data couldn't be set aside, and nothing was moved. Check the folder's permissions and try again.") from error
