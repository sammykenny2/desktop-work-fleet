# Google Drive reset diagnostics handoff

## Purpose and immediate boundary

The maintainer requested this handoff on 2026-11-03 before any further implementation or release work.
The unresolved issue is an installed macOS app that cannot finish resetting its old Google Drive data.
Repeated previews and passing isolated tests have not established that the actual account can complete reset.
The next investigation must obtain authenticated provider evidence instead of asking the maintainer to install
another speculative fix or remember transient progress counters.

This is a defect-investigation handoff requested by the maintainer, not a new status log or a release completion
record. Git history remains the change log; the linked Actions runs and GitHub Releases own publication results.
No code correction, authenticated probe, workflow retry or phone installation was performed while preparing
this document.

Read [AGENTS](../../AGENTS.md), your own agent instructions and [AGENT-GUIDE](../AGENT-GUIDE.md), then
[ADR-062](../decisions/062-dataset-checkpoints-and-deletable-history.md),
[SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md),
[PLAN-011](../plans/011-dataset-checkpoints-and-deletable-history.md) and [testing](../testing.md).
This handoff does not turn PLAN-011's open protocol, real-provider or independent-review gates into passes.

## Requirements already settled

- Old data does not need migration. The maintainer accepts an explicit reset and rebuilding from zero.
  A signed-in account with old cloud notes must still reach Settings and the reset action, including when the
  local database contains an incompatible format. Do not make loading old note contents a prerequisite.
- Current-state access and ordinary sync must avoid scanning all historical versions. Expensive retrieval is
  acceptable when explicitly restoring a very old version. Current snapshots, bounded incremental work and lazy
  history are the chosen direction; the dataset is distinct from the backup password vault.
- There is no per-version age retention. Future expiry applies to whole notes after entering Trash and remains
  deferred. Whole-note permanent deletion and Empty Trash are implemented. SPEC D03 makes a verified purge
  terminal for that identity; unpublished work is preserved for Save as copy. Do not change this rule as an
  incidental reset fix. SPEC D07's note-owned attachments can duplicate storage when copying notes.
- Pre-store note, sync and backup schemas retain V1 labels. The dataset discriminator and changed V1 contents
  are not a migration promise. Older whole-workspace formats and backups are incompatible.
- Direct Conventional Commit and push to `origin/main` are authorized. The maintainer previously delegated the
  next patch choice and four-platform standard preview for this repair and explicitly rejected another version
  question. The latest instruction is to write this handoff first; it is not an instruction to resume publication.
- Four-platform preview means Windows, macOS, Linux and Android. iOS builds and device installations stay local.
  For a later Android installation, the requested device is Ken-APhone / Pixel 9 Pro, **user 0 only**; re-resolve
  the connected device instead of assuming a saved serial is still attached.

## Observed failure and what remains unknown

The maintainer first reported clearing progress at `0/106`, followed by an apparently inert Continue action.
Subsequent reports included invalid/incompatible records, an unconfirmed native outcome, invalid Drive response
format/capacity, unnecessary creation of 59 cloud objects for an empty account, and invalid file identity/format.
The latest reported code from the installed Apple host is **`dataset-response-type`**.

That code identifies the metadata type check. It does **not** identify the actual returned `mimeType`, the failed
file's kind, its ID, whether it was a create acknowledgement or subsequent read-back, or the reset phase. None
of those fields has been captured from the authenticated account. The maintainer did not know the progress
counter at failure; do not ask that question again or infer its value.

There is no authenticated end-to-end success evidence for the dataset reset. Earlier flat-file sync evidence,
mock providers, native adapters with synthetic HTTP, successful packaging, and the public unauthenticated batch
probe below do not establish it. The exact current cloud inventory and saved reset journal are also unknown.

## Source anchors for resuming

The working tree was clean before this handoff. Its code baseline is
`9c45d9e177c4545ad8b9291b2152ade15acae2c9` on `main`, containing the 0.5.8 version records and
`124438489a6384fcd1916ebbe9c7bfac33060752`, the ordinary-MIME correction. Consult the commit bodies for the
individual changes; the following anchors identify where to investigate, not proof that the live incident is fixed.

| Concern | Commit | Entry points and evidence |
|---|---|---|
| Continue blocked by open Settings; durable progress/error reporting | `a5d1d3b` | `src/main.js`, reset UI and renderer probes; isolated-provider evidence |
| Metadata-only clearing before empty initialization; captured IDs and batched deletion | `4609d16` | [DatasetReset](../../src/sources/dataset-reset.js), [SPEC-010](../specs/010-dataset-checkpoints-and-deletable-history.md) |
| Apple cold authorization loses a continuation | `6c5a32d` | [FleetGoogle](../../src/native/apple/Shared/PinItAnywhereGoogle.swift); installed-app log evidence plus deferred SDK fixture |
| Real multipart batch response framing | `e21d2c3` | [Batch research](../research/2026-11-03-drive-batch-response-framing.md), [captured fixture](../../tests/fixtures/dataset/drive-batch-response.json) |
| Empty initialization and field-specific Apple diagnostics | `5922423` | [Lifecycle](../../src/sources/dataset-lifecycle.js), [lazy folders](../../src/sources/dataset-folders.js), [empty-dataset tests](../../tests/dataset-empty.test.js), [FleetDataset](../../src/native/apple/Shared/PinItAnywhereDataset.swift) |
| Ordinary MIME classification and consistent upload media types | `1244384` | [MIME research](../research/2026-11-03-drive-dataset-media-types.md), [codec](../../src/sources/dataset-codec.js), platform adapters below |

Other earlier review fixes are already in the baseline: transaction staging and separated draft baselines
(`3f590eb`), native text preservation and large Android attachment reads (`23ab23f`), expired reset pages and
publication visibility (`4a5443b`), bounded shard storage (`4ab5c88`), and closable recovery with CI reset probes
(`af57f8b`). These must not be described as newly completed by the next session. Their real-device boundaries
remain in testing and PLAN-011.

The related quit/update work is also already committed: write draining before update/quit (`adf64e5`) and macOS
update-dialog focus/placement (`2ca862a`). Its contract is [SPEC-006](../specs/006-desktop-window-startup-and-updates.md).
The active incident is cloud reset; successful update packaging does not verify either reset or native UI behavior.

## Reset behavior that matters to this incident

### Why there were 106 clearing targets

The UI counter represents captured cloud file targets, not 106 notes whose contents need interpretation.
The current reset captures old **leaf file IDs from metadata**, writes a legacy-compatible reset fence, clears
those exact IDs, initializes the empty dataset and activates it. It does not download old revision contents to
decide whether they may be deleted. The installed account's individual 106 targets were not inspected.

The adapters batch up to 100 file deletions into one Drive HTTP batch. Each inner deletion still needs an
individual result. Only verified success or already-missing results retire an ID from the durable journal.
Reopening retries the remaining original targets, not a newly expanded account-wide deletion set.

Expired capture page tokens restart capture before publication; an expired residual-audit token restarts only
the audit. Late legacy writes are retained and reported. Old folder containers are deliberately retained to
avoid cascading into children that were not captured. Therefore this implementation does not promise that
the entire app-data folder has literally zero remaining objects. Seeded backup replacement has a separate
ordering; do not rewrite it as though it were an empty reset.

### Why there were 59 initialization objects

The old initializer eagerly planned 39 folders and 20 records, even with no notes: root/category folders,
17 current-shard folders, 16 purge-bucket folders, a default-group folder, 17 checkpoints, descriptor, ready
receipt and group revision. This was application scaffolding. The planned counter was not evidence that all
59 objects had actually reached Drive.

Since `5922423`, a fresh empty initialization creates **three physical objects**: root folder, dataset
descriptor and ready receipt. Explicit reset also has its separate legacy fence, making four new objects in
that flow. Reserving 40 file IDs in a bulk request does not create 40 Drive files. Unused folders, the default
group and empty checkpoints are deferred; first capture creates what it needs. Backup replacement seeds only
populated shards.

Interrupted old jobs keep their operation and reserved IDs while dropping uncreated scaffolding. Already
created old folders can remain. An acknowledged root is not silently recreated, and a ready dataset's retired
initial checkpoints are not replayed. Consequently, three is a fresh initialization count, not an assertion
about the entire inventory after an interrupted older reset.

Sparse ready receipts permit zero initial checkpoints, still read existing full receipts, and require updating
older clients before they join a newly sparse dataset. This is a pre-store V1 change. The same commit also
fixed a numeric `allocateFileIds(count, options)` argument being spread into an object by the sync cancellation
wrapper; the earlier fake provider did not expose that bulk method. That defect was found in tests, but was not
proved to be the maintainer's reset failure.

## Evidence for the latest fixes

### Apple authorization

An earlier installed-app log showed `token(_:) leaked its continuation`. Concurrent cold restorations used
the global Google Sign-In SDK callback slot. The fix shares one restoration task across host instances,
coalesces authorization within each host and reuses the verified identity of an unchanged token. Closed hosts
still stop before issuing further requests. This is evidence for an authorization defect, not a full reset pass.

### Real Google batch framing

A real, unauthenticated, read-only request sent an inner `GET /drive/v3/about?fields=kind` to
`POST /batch/drive/v3`. The outer response was 200, its inner result 401, and the body began with
`\r\n--batch_...`. The earlier parser rejected that leading CRLF.

The parser now handles MIME preambles/epilogues and delimiter padding while retaining bounded size, closing
delimiter, unique Content-ID, result-count and per-part status validation. The normalized response fixture is
tracked; raw local evidence is `build/drive-public-batch-response.bin`.
This proves actual response framing only. It did not authenticate, upload, list account files, delete account
files, or finish a reset. See the linked batch research for primary sources and reproducible boundaries.

### MIME rejection

An isolated invocation of the 0.5.7 Swift validator reproduced `dataset-response-type` with unchanged valid
identity, parent, properties, size and digest, replacing only `application/octet-stream` with `application/json`.
The local reproduction is in `build/mime-reproduction/` (`FleetDataset.swift`, `Probe.swift`, compiled `probe`).
Those files are ignored artifacts; the research and regression fixtures are the durable evidence.

Commit `1244384` makes dataset JSON metadata, resumable initiation and content chunks consistently use
`application/json`; attachments and legacy opaque files retain their binary media type. Ordinary bounded MIME
labels no longer determine protocol identity. Exact folder typing, rejection of `application/vnd.google-apps.*`
byte-file substitutes, parent/app-data/properties/size/digest checks, and decoded payload validation remain.
Existing valid bytes under a reserved ID can be read without replacement, a metadata PATCH or another reset.

This is a controlled reproduction, **not a captured response from the affected account**. The actual failure
could involve a folder or an absent/otherwise invalid label. Do not state that Google returned JSON, changed
the type, or that 0.5.8 fixes this particular account without observing it. The current ordinary-label parser
also rejects parameters such as `application/json; charset=utf-8`; no such Drive metadata was observed.

Platform entry points are [JavaScript Drive](../../src/sources/google-drive.js),
[Apple Drive](../../src/native/apple/Shared/PinItAnywhereDrive.swift),
[Windows metadata](../../src/native/windows/core/DatasetFiles.cs) and
[transport](../../src/native/windows/app/NativeGoogle.cs),
[Linux metadata](../../src/native/linux/dataset.py) and [transport](../../src/native/linux/google.py), and
[Android metadata](../../src/native/android/app/src/main/java/dev/sammykenny2/pinitanywhere/nativehost/DatasetFiles.java) and
[transport](../../src/native/android/app/src/main/java/dev/sammykenny2/pinitanywhere/nativehost/GoogleFiles.java).
Shared cases are in [native-wire.json](../../tests/fixtures/dataset/native-wire.json).

## Verification evidence and a correction to the prior check report

At the MIME implementation commit, local `npm test` reported 559 passed and 10 skipped;
`python3 -m unittest discover -s tests -p 'test_*.py' -v` reported 222 passed and 53 skipped. Android
`testDebugUnitTest` and Java compilation passed. Build, documentation and whitespace checks passed.
The relevant local logs are `build/mime-final-js.log`, `build/mime-final-python.log` and
`build/mime-android-tests.log`. These checks preceded the subsequent release-notes edit.

**The 0.5.8 bump commit's claim that all 28 selected checks passed is incorrect.** Inspection for this handoff
found that `build/mime-version-tests.log` actually records **27 passed and 1 failed**. The failed case is
`release notes describe changes, not publication status`, at `tests/release-notes.test.js:56`.
The 0.5.8 entry contains `the published 0.5.7 validator`, which matches the prohibited
`/\b(published|prepared)\b/i` expression. The failing result was missed before the commit and dispatch.
Do not reuse the erroneous commit-body assertion as verification evidence or rewrite history to conceal it.

Both the [0.5.8 CI run](https://github.com/sammykenny2/desktop-work-fleet/actions/runs/41509663733) and
[preview workflow](https://github.com/sammykenny2/desktop-work-fleet/actions/runs/41509690346) fail on this test.
The preview's platform builds and publication job were skipped. The local captures are
`build/handoff-058-ci-failure.log` and `build/handoff-058-release-failure.log`.
This is a release-notes check failure, not new evidence about the Drive error. It remains unfixed at handoff.

The latest available preview at this inspection was
[0.5.7](https://github.com/sammykenny2/desktop-work-fleet/releases/tag/v0.5.7), from `aecae696`.
Its package/source contents, signatures and asset digests were checked; the maintainer still reported the MIME
failure after that version. Local artifact evidence is under `build/verify-0.5.7/`, with
`build/verify-0.5.7.mjs`, `build/verify-0.5.7-content.py` and `build/release-0.5.7-metadata.json`.
The 0.5.8 verification scripts exist but are preparation only; no 0.5.8 package was verified or installed.

Chromium/WebKit and Android/iOS-sized renderer reset probes use isolated native bridges/providers, including
real IndexedDB and production batch parsing. They do not exercise an installed phone or authenticated Drive.
Useful entry points are [legacy reset UI probe](../../scripts/testing/legacy-google-reset-ui-probe.mjs) and
[dataset UI probe](../../scripts/testing/dataset-ui-probe.mjs). Native HTTP probes also substitute responses.
No independent review of the latest fixes occurred; author-run tests are not independent review.

## Authenticated probe investigation: started, not implemented

Only read-only source discovery had started when the maintainer requested this handoff. No authenticated
probe exists from that investigation, no OAuth session was obtained for it, and no real account data was
read or deleted by it.

[FleetGoogle](../../src/native/apple/Shared/PinItAnywhereGoogle.swift) uses the configured Apple client ID,
`drive.appdata`, the Google Sign-In SDK session and application Keychain account metadata. Interactive sign-in
needs a native presenter. Token preparation restores/refreshes through the SDK and checks the account identity;
it is not a documented token-export API. A new standalone process is not established to inherit the installed
application's session. Existing [Apple startup probes](../../scripts/testing/apple_startup_probe.py) use isolated
app identities and storage; they do not provide authenticated Drive acceptance.

The remaining choices are proposals, not validated mechanisms:

1. Add an explicit diagnostic action within the authorized native host, using its own existing authentication
   boundary, and return redacted request/response evidence without serializing tokens.
2. If that path is unavailable, use a separate interactive OAuth authorization with an appropriate configured
   client and isolated test data. Verify the client type, redirect mechanism and scope before implementing it.
   Do not assume that a generic Drive connector shares this application's app-data space.

A useful probe must exercise the actual production adapter against Drive: reserve IDs, create an isolated
root and small JSON object, capture create/GET/list metadata, verify downloaded bytes, check nested parents
and discovery, and clean up only the exact IDs that the probe created. Capture method/phase, status, response
MIME, file kind, parents/spaces, expected-versus-actual size/checksum and the validation field; redact bearer
headers, account identity and unrelated content. Retain the observed responses as sanitized fixtures.

Test markers must not be recognized as production dataset descriptors or reset fences. A probe in an existing
user account must not invoke the general reset routine or delete an entire parent folder. Full reset/fencing
acceptance requires an isolated authorized test namespace/account where production discovery cannot consume
test records and destructive scope cannot include the maintainer's existing data. The isolation design is
unfinished; do not assume a random folder name alone proves it.

## Resume order and environment constraints

1. Read the exact failure and verification corrections above before changing or publishing anything. A future
   release attempt must address the release-notes failure and check the actual exit status; this handoff leaves
   the failure in place because the requested work is documentation.
2. Establish a legitimate authenticated probe path and capture the actual failing metadata. If interaction is
   essential for OAuth, explain that concrete need once; do not send the maintainer back to counters or repeated
   preview installs. No authentication capability has yet been proven available to a standalone probe.
3. Reproduce the captured provider behavior with the production validators and make the smallest evidenced
   correction. Preserve the existing confirmed reset job and captured targets. Extend regression fixtures from
   the sanitized real response rather than weakening identity/byte checks to make mocks pass.
4. Verify actual empty reset, continuation after interruption, first capture, reopening and a second device's
   discovery. Report each unrun platform/provider boundary explicitly. Only then assess another delivery under
   the maintainer's authorization and the normal deployment rules; do not reuse an existing published tag.

Computer use is unavailable on this Mac by the maintainer's explicit instruction. Do not retry app selection
or ask to enable the missing ChatGPT computer-use permission. Earlier access to the installed app's protected
data container was denied by macOS; do not bypass it through another tool, credential extraction or a copied
identity. Read-only system-log inspection did not expose the latest MIME response. No useful live trace was
recovered from that attempt.

Prefer legitimate native APIs, source inspection and authorized CLI operations. Keep tokens, keys, real note
bodies and device identifiers out of tracked files and tool output. Build artifacts and raw diagnostic logs
belong in ignored `build/`; their presence on this Mac is not a guarantee they exist in another checkout.
The task-created renderer preview server was stopped. Do not stop unrelated existing processes.

For local reproduction, the Apple toolchain is selected with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; Android uses the Android Studio bundled JBR and
the SDK under the user's `Library/Android/sdk`. Exact supported commands and platform limits remain in
[testing](../testing.md) and [deployment](../deployment.md). No new background listener or auth callback server
was introduced by the unfinished probe investigation.
