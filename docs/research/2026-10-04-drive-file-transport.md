# Drive immutable file transport research

Reviewed: 2026-10-04. The following is official API evidence; acceptance with a real account/on the five platforms
has not been run.
The code is implemented independently from the documentation; no official samples were copied. The accepted design
is in [ADR-012](../decisions/012-durable-file-store-and-drive-adapter.md).

## External evidence

- appDataFolder uses the drive.appdata scope; create sets the parent to appDataFolder, and list must also specify
  spaces.
  It is separate from the user-visible Drive file space and should not be treated as a directly manageable backup
  interface.
  [Official app data guide](https://developers.google.com/workspace/drive/api/guides/appdata)
- files.generateIds can specify space=appDataFolder, type=files; the parameter here is the singular space.
  [generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- A pre-generated ID can be reused when the earlier result is uncertain; after a successful create, a retry with the
  same ID conflicts. A resumable upload first obtains a Location;
  later PUTs can be chunked, and every chunk except the last is a multiple of 256 KiB. Resuming first queries the
  status and uses Range to decide which bytes were received;
  404 or any 4xx requires reopening the session. An upload session is valid for one week.
  [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- files.list pages are not guaranteed to be full; incompleteSearch means the enumeration did not complete; when a file
  page token is rejected, start again from the first page.
  [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- changes.list uses spaces=appDataFolder. Intermediate pages provide nextPageToken, and the last page provides
  newStartPageToken;
  restrictToMyDrive=true excludes appDataFolder, so this restriction must not be added.
  [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- getStartPageToken provides the starting point for changes; its API has no spaces parameter.
  [getStartPageToken](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/getStartPageToken)
- A File's size is a string; sha256Checksum is a read-only content checksum that may be present; appProperties
  require authenticated access.
  [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- 401 requires handling sign-in; 403 is told apart by reason into rate limiting and quota/permission. 429/5xx use
  backoff, and retries never clear pending data.
  [errors](https://developers.google.com/workspace/drive/api/guides/handle-errors)
- Several clients in one Cloud project can be treated as one logical app, and the user's scope grant is trust at the
  project level.
  This model supports a same-project configuration, but cannot replace real visibility tests of
  appDataFolder/appProperties on each platform.
  [Cross-client identity](https://developers.google.com/identity/protocols/oauth2/cross-client-identity)

## This project's inferences and design

Data is downloaded, verified and saved atomically before the cursor advances; an interrupted page does not roll back
data already saved.
After a successful upload, the server checksum is checked first, and the file is actually read back when the checksum
is missing; a 409 is also read back, so the content under the same ID is guaranteed consistent.
When the source is cleared externally, the local version is kept and reported; an explicit recovery strategy is
required, and delete intent is never guessed from missing files.

Native transports must restrict origin/redirects/response size. The resumable URI is treated as protected connection
information and is not put into ordinary JSON, diagnostics or backups; losing the URI allows rebuilding the session,
and the persisted file ID still keeps it the same operation.

## Not verified

There is no real Google project, OAuth clients, scope consent or live HTTP result yet.
Documentation and scripted HTTP tests do not prove the visibility of the same account's data to the five platform
clients in one project, Google's real consistency/quota/network interruptions, or native OS secure storage. These
acceptances are kept for S12.
