# Windows native backup files and encryption research

Reviewed: 2026-10-04. Based only on official public API documentation; no external application code or data contract
was brought in.
The decision is in [ADR-016](../decisions/016-windows-native-backup-files-and-vault.md); current status is in
[PROGRESS](../../PROGRESS.md), with history and verification evidence in the git history and [testing](../testing.md).

## Official evidence

- `CreateFile` with create-new rejects an existing file; the share mode affects other opens/write/delete,
  and rename also needs delete access. [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- The Windows SDK user-mode `NtCreateFile` accepts `OBJECT_ATTRIBUTES.RootDirectory`, so it can operate relative to an
  already open directory; `FILE_CREATE` is the disposition that only creates a new file.
  [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
- `OBJ_DONT_REPARSE` can reject reparse points met during name resolution.
  [OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes)
- A file's disposition can be set through an open handle; while other handles remain, the file may actually disappear
  only once they close.
  [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle),
  [FILE_DISPOSITION_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_disposition_info)
- .NET `AesGcm.Encrypt` outputs the ciphertext and the tag separately and supports AAD; a nonce must never be reused
  with the same key.
  [AesGcm.Encrypt](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.aesgcm.encrypt)
- .NET provides PBKDF2 with byte input and a SHA256 option; explicit UTF-8 is used, with no password normalization.
  [Rfc2898DeriveBytes.Pbkdf2](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.rfc2898derivebytes.pbkdf2)
- The ZIP is packaged with the BCL `ZipArchive`/NoCompression with two fixed file names, and the actual output is
  additionally verified by the strict shared reader.
  [ZipArchive](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.ziparchive),
  [CompressionLevel](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.compressionlevel)

## Engineering judgment and local observations

Merely guarding against a symlink at the last component is not enough to stop re-resolution to another location after
an ancestor is renamed; a held directory handle is used.
Restarts must re-establish the capability, so the Volume GUID path is saved and then compared with the native
identity. The Windows volume GUID namespace itself goes through a system mapping; only the volume root is opened with
Win32, and the saved directory is then opened relative to it with no-reparse.
The first version, which used no-reparse directly on the whole GUID native path, actually received 4395; a real NTFS
probe reproduced this and it was fixed.

The tests cover: no overwrite of a same-name file, write/rename races, keeping a file that was modified/swapped with
the same bytes, hash→delete on the same handle, cancel leaving a partial file, rejecting traversal/ADS, rejecting a
replaced folder, and an ancestor rename not changing the held destination.
Chinese/emoji passwords and the full content encrypted by the native vault are restored by the WebCrypto reader; the
test stdio explicitly uses UTF-8 so the Windows console code page cannot corrupt the password fixture.

An independent adversarial test also found that releasing the handle right after verifying the newest backup let
another process change the newest file while the old file was being hashed.
The newest file is now held with an exclusive write/delete lock until the old file's disposition completes; rerunning
the original race probe showed the change is blocked.
An empty new file left after an SQLite identity reservation fails must be listed as unconfirmed, and not confused with
"not created yet".

## Verification boundaries

The WPF probe replaces only the interactive folder-picker result; the native IPC/DPAPI/SQLite/NTFS/encryption that
follow all really run.
Not yet done: automating the real OS picker, testing external-disk disconnection/power loss, every minimum Windows
version or the store sandbox.
Backends other than NTFS do not claim equivalent guarantees on their own; other platforms need their own
implementation and acceptance.
