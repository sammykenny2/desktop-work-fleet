# Validation Version API

Updated: 2026-10-03. Implementation: `src/server/work_fleet.py`, schema 1; every write is committed in an SQLite
transaction.

The same origin serves HTML and JSON. The JSON API uses `Authorization: Bearer <device-token>`;
only `POST /api/pair` needs no token. Every request checks the device role and revocation status again.
Responses and static pages use `Cache-Control: no-store`; the service worker caches only the credential-free editor
shell.

| Method/path | Behaviour |
|---|---|
| GET /api/snapshot | epoch, role, device, all notes (including tombstones) |
| POST /api/operations | create / update / delete / restore; editor/admin |
| POST /api/pair | `{code,name}` exchanges a one-time invite and returns a device token |
| POST /api/invites | admin creates a viewer/editor invite; valid for 300 seconds |
| GET /api/devices | admin lists id/name/role/revoked; tokens are not returned |
| POST /api/revoke | admin revokes `{device}`; a device cannot revoke itself |

Body for creating a note:

```json
{
  "epoch": "generation UUID taken from the snapshot",
  "operation": "fixed UUID for each operation",
  "action": "create",
  "id": "new note UUID",
  "text": "Idea\n- [ ] To do",
  "board": "Inbox",
  "status": "todo"
}
```

`status` is only `todo`, `in_progress` or `done`. Text is 1–12000 characters, the group 1–80 characters.
A group is a simple label on a note; no required project or agent fields are introduced. To-dos are written as
`- [ ]` / `- [x]`.

Updates use `action:update`, `revision` and `patch:{text?,board?,status?}`.
Delete and restore use `action:delete|restore` and `revision`; only an explicit restore brings a tombstone back.

A competing write returns 409 with `current`; an epoch mismatch returns `epoch_changed`.
A retry of an already committed request from the same device, with the same operation and the same body, returns the
original result without writing again. Reusing an operation for a different body returns 409. A revoked device that
retries an old operation still gets 401.

A network error or 503 does not mean the server did not write; the client keeps the original body and operation and
sends them again. Drafts are never overwritten by a poll, a 409 or a 401. The UI allows saving a copy and keeps the
original draft for comparison.
After a backup restore, every device needs to pair again, and drafts from the old epoch must be saved as copies
explicitly.

The request body limit is 64 KiB; writes must be application/json. Host and Origin are validated, and there is no
cross-origin CORS. The HTTPS origin is set by the service configuration; a forwarded Host is not trusted. There is no
JSONP, no arbitrary file serving and no remote code entry point.
