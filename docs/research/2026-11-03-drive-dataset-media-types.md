# Drive dataset media types

## Evidence

The maintainer reported `dataset-response-type` from the installed Apple host after the sparse-initialization
correction. This identifies the MIME equality check. It does not reveal the actual returned MIME value or prove
that Drive changed a particular upload's type; no authenticated response was captured.

The published validator requires every non-folder dataset object, including JSON records, to report exactly
`application/octet-stream`. An isolated invocation of that validator reproduces the reported code with the same
valid ID, parent, private properties, size and SHA-256, changing only the media label to `application/json`.
The native and renderer validators have the same excessive equality requirement.

Google's [upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads) distinguishes
metadata `Content-Type` from the media type in `X-Upload-Content-Type`. Its
[file resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) describes MIME as a
file type and permits detection when no type is supplied. The
[create API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) accepts valid media
types generally. These documents do not establish why the maintainer's returned type differed.
Accessed 2026-11-03.

## Correction

Dataset JSON records use `application/json` consistently in metadata, resumable initiation and media chunks.
Attachments and legacy opaque files retain `application/octet-stream`. On read-back, an ordinary file's media
label is not part of protocol identity: accept a bounded valid ordinary MIME label while still verifying its
ID, app-data space, exact private properties, parent, size, SHA-256 and decoded record. No label can bypass those
checks. Folders still require the exact folder type. Google-native document, shortcut and other
`application/vnd.google-apps.*` types cannot be treated as uploaded byte files.

The descriptor and checksums do not contain MIME, so a saved pending reset can read an already-created ordinary
file under the same reserved ID without replacing it. No data migration, metadata PATCH or expanded deletion
scope is required. Apply the rule to JavaScript, Apple, Windows, Linux and Android so another device does not
reject the same verified bytes.

## Verification boundary

Shared fixtures exercise JSON, plain text, binary and image labels; reject missing/malformed labels, Google
native types and folder/file confusion. Real Apple and Linux adapters use synthetic HTTP to verify upload
headers, differing response media labels and unchanged byte/parent validation. JavaScript read-back checks
ensure a changed label cannot accept corrupt bytes. Android unit tests and Windows core fixtures share the
classification boundary. These are controlled reproductions, not authenticated Drive acceptance.
