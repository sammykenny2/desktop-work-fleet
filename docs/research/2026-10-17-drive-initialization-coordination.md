# Drive initialization coordination: evidence and the adopted decision

Reviewed: 2026-10-17. Only Google's official documentation was consulted; no user account was touched.

## Evidence

- [The File resource's name](https://developers.google.com/workspace/drive/api/reference/rest/v3/files): names are not guaranteed to be unique within a folder; same-name init files cannot serve as a unique key.
- [Upload retries with a pre-generated ID](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files): a known file ID can be retried safely; an existing ID returns 409.
  This mechanism does not merge IDs that different devices allocated on their own into one record.
- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list): provides incompleteSearch; an incomplete enumeration cannot be taken to mean that all data has been cleared.

## Proposal and Decision

Derived from the limits above: no implicit lock based on a same-name file or first-come-first-served; instead a
verifiable, immutable prepare/ready.
This is this project's protocol design, not an atomic initialization API that Google provides. Adopted in
[ADR-054](../decisions/054-explicit-workspace-initialization.md).
New accounts share a deterministic plan; a destructive reset is continued only by the initiator that holds the durable
journal, and followers wait.
