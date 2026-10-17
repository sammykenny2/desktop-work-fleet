# Automatic backup file capabilities and replacement races

Reviewed: 2026-10-04. The decision is in [ADR-014](../decisions/014-durable-automatic-backups.md).

## External evidence

The [WHATWG File System Standard](https://fs.spec.whatwg.org/#locator) links a handle to a locator that contains a
root/path, and states explicitly that files can be modified by applications outside the specification; how external
changes are reflected depends on the implementation.
This cannot be taken as a promise of a permanent inode/file identity or of conditional overwrite/delete.

The [Chromium remove() shipping discussion](https://groups.google.com/a/chromium.org/g/blink-dev/c/tESXuOfqQMQ)
describes deleting directly through a handle and an exclusive lock. It does not provide the "expected bytes/original
entity" compare-and-delete contract this product needs, so the method name handle.remove is no reason to assume the
replacement race is solved.

## Local experiments and inferences

An independent Edge/OPFS synthetic probe swapped in foreign content under the same name between the empty-file check
and saving durable ownership. isSameEntry on the old handle could still be true, and the following writable save
overwrote the replacement file.
Another probe swapped the file between the hash check and removeEntry; deleting by name still hit the replacement file.
These were controlled synthetic files; no private user data was touched.

The browser implementation of automatic creation/cleanup was therefore removed, and the capability is explicitly
unavailable; saving to a manually chosen destination file remains.
This conclusion is only about this product's automatic file contract; it does not imply that every FSA use is unsafe.

## Verification boundaries

The automatic scheduler probe uses a real IndexedDB journal, the shared Workspace/ZIP code and a synthetic atomic
FileHost. It can verify reservation/ack/restart/settings/UI/cancel; it cannot prove OS files, the vault or native
capabilities on the five platforms.
Native hosts must separately provide failure evidence for create-only and identity-bound cleanup; a pathname
pre-check cannot replace it.
Current status is in [PROGRESS](../../PROGRESS.md); history and verification evidence are in the git history and
[testing](../testing.md).
