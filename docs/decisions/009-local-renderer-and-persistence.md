# ADR-009: Local renderer, drafts and attachment storage

## Status

Accepted (shared interface and browser adapter), 2026-10-04.
Native hosts on the five platforms, Google sync and portable backup are completed by later decisions.

## Context

The core in [ADR-008](008-portable-interaction-core.md) needs real DOM interaction and a persistence boundary
to validate editing on a fixed paper, drag and drop, draft recovery and attachments. The existing 0.1.0 HTTP/SQLite
prototype cannot become the 1.0 runtime architecture, which has no note server.

## Decision

- `src/app` uses native ES modules and locally packaged assets. The development preview only serves static files
  and does not receive notes, attachments or credentials. Production hosts do not depend on the development
  listener.
- The browser adapter `src/storage/indexed-db.js` partitions by profile and uses a single readwrite transaction
  for the revision comparison and the whole Workspace commit, reporting success only after the transaction
  completes.
  Web Locks limit each profile to one workspace coordinator, and CAS still prevents competing writes.
- IndexedDB strict durability is requested; this is an API request, not completed acceptance of power-loss or
  hardware durability.
  Native files, OS secure storage and multi-surface IPC must follow the same transaction contract and are
  implemented separately.
- Drafts share a save boundary with cards and the outbox. A draft is deleted only after it is committed; on a
  version conflict it can be saved as a copy.
  A recovered draft carries the baseline of the original; on a successful save only an original that has not
  changed since is removed.
  While a write is in progress or has failed, the edited content and a leave-page prompt are kept; asynchronous
  writes after the page closes are not relied on for data safety.
- Marked 18.0.14 parses GFM; raw HTML is shown as text, and the generated DOM is then cleaned with the allowlist of
  DOMPurify 3.4.16. External images are not loaded automatically, and links allow only HTTP/HTTPS/mailto.
  A checklist change edits the matching parsed task, keeping code blocks, escaped text and the rest of the source.
- Attachments are at most 25 MiB per file and addressed by SHA-256; the bytes are saved successfully before the
  draft reference is written.
  Attachments are isolated per profile; download URLs always use application/octet-stream,
  and HTML/SVG is never rendered on the app origin. The original MIME metadata and bytes are kept for export and
  future source integration.
- A fixed paper can be edited in place, and the full editor provides a formatted preview and attachments; closing
  saves the draft first.
  The list, search and archive/delete views do not change desktop geometry; a hidden region cannot serve as
  evidence of a smaller screen.
- Dependencies are pinned with a lockfile, and the build copies the runtime ESM with full licenses and notices;
  Playwright is only a test dependency and no browser is packaged. The CSP allows no remote scripts and no
  arbitrary inline scripts.

## Consequences

### Positive

- A real browser can test the renderer and failure boundaries on its own, and the core and native hosts can
  iterate separately.
- Content, drafts and pending sync operations cannot end up half-saved because the UI showed success first.
- Phone widths also have entries for drafts and settings; this does not replace delivering native iOS/Android
  apps.

### Negative

- The capacity and performance of writing the whole Workspace snapshot still need acceptance with large data;
  unreferenced attachment bytes are not cleaned up automatically for now.
- Browser storage is limited by origin, browser profile, user clearing and quota; the preview is not a real
  backup.
- A browser without Web Locks refuses to open, with a clear message; native host capabilities and minimum versions
  are accepted separately.

### Neutral

- The UI's resident layer option currently stores a policy; the browser does not claim OS layering,
  pass-through or global shortcuts.
- Automatic/encrypted backup, account OAuth, group merge and native packaging still have to be completed; the 1.0
  scope is not reduced.

## Alternatives Considered

### Keep the prototype's localhost API

- It already has SQLite transactions and an old app; but it does not match the 1.0 direction of no local note
  server, so it was not adopted.

### A hand-written Markdown parser or a remote renderer

- It would save one local package or reduce packaging; but parsing, security, offline use and privacy are harder
  to control, so it was not adopted.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md)
- [IndexedDB transaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)
- [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Marked](https://marked.js.org/using_advanced)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [Third-party notices](../../THIRD-PARTY-NOTICES.md)

*Decision made: 2026-10-04*
