# macOS validation version 0.1.0 report

Date: 2026-10-03 (Asia/Taipei). Original baseline `8a7da58`.
The delivery scope is an operable validation version; passing evidence for every platform and every desktop gesture
has not been obtained yet.

## Environment and artifacts

- macOS 26.7.1, build 25G241, x86_64; 1 display was detected at run time.
- Command Line Tools, Swift 6.3.3, deployment target macOS 13.0.
- Python 3.14.7, SQLite 3.51.0; Node 24.21.0 only for the JS tests.
- `build/Work Fleet.app`, bundle ID `io.workfleet.validation`, ad-hoc signature.
- `codesign --verify --strict` passed. The actual entitlements are only `app-sandbox` and `network.client`.
- `otool -L` lists only Apple system frameworks and dylibs and the system Swift runtime; no third-party framework is
  embedded.
- `src/server/`, `src/web/` and `src/macos/` are all original work of this project; no old application or assets were
  brought in.
- A clean directory was also exported from the staged index, and the build and the strict codesign verification
  completed there from an empty Swift module cache; the 13 HTTP/SQLite tests, the 8 JS tests and the document checks
  also passed in that copy. That copy's `python3` was the CLT 3.9.6 (the main test environment was still 3.14.7; the
  documented support target is 3.12+).
- [Setup](../setup-guide.md), [API](../api.md), [dependency inventory](runtime-inventory.json).

## Passed (scoped by the evidence)

| Concern | Evidence and result |
|---|---|
| Does it really receive data | The real signed app started in the Sandbox and polled a temporary HTTP/SQLite server; note count 0→1, revisionSum 0→1 |
| Is the Sandbox effective | container=true; writing a synthetic test file to `/Users/Shared/` was refused with NSCocoaErrorDomain 513; outgoing network connections succeeded |
| Read-only and focus policy | Locked snapshots all had ignoresMouse=true, canBecomeKey=false, isKey=false; the native view was confirmed readable |
| Background data updates stealing focus | The frontmost PID was the same before and after the updates, and the background baseline did not change; covers only the period of this test |
| Unlock and relock | After unlock ignoresMouse=false, canBecomeKey=true; after relock back to true/false, and not the key window |
| Real editing and a common source | WebKit in the Sandbox saved through the actual DOM form, and SQLite could read it; the native snapshot received the content count after the addition |
| Quick capture and to-dos | In WebKit, adding, persisting a `- [ ]` tick, hiding and restoring Done, and deleting and restoring passed; no extra mandatory workflow |
| Two clients editing at once | Two independent HTTP devices wrote in parallel; only one got 200, the other 409/current; the losing draft in WebKit was still there |
| Retry after a lost response | WebKit discarded a response the server had already committed and pressed retry; only one record resulted; after reopening the DB the same operation returned the same result |
| Retry after a disconnect | A connection failure was injected into the real WebKit transport; the draft and the same operation were kept; after the transport recovered, the resend succeeded |
| Draft retention | Input reached storage on every change and was recovered after a real WebView reload; recovery in two tabs used independent records, and a successful send did not delete the other tab's draft |
| Save failure | A localStorage quota error was injected; switching away, which would lose the in-memory text, was blocked, and the first text not yet stored was also kept; a SQLite write failure rolled back, and a retry could succeed |
| Deletion and offline reconnect | A tombstone refused updates from old revisions and reuse of the same id; only an explicit restore can bring it back |
| Backup and restore | Online backup, restore to a new path, content recovered, epoch changed, old tokens refused, a draft from the old epoch got 409 |
| Interrupted restore | With a fault injected after the backup copy, the destination DB was not published; it was published with atomic create-only only after the authorization rotation finished |
| Device pairing | One-time use, expiry, only one success among concurrent redemptions, viewer writes refused, and after revocation reads, writes and retries of old operations were all refused |
| QR | Native CoreImage generated a real short-lived invite QR code, and CoreImage decoded it back to the same URL; it contains no permanent token. Not tested with a phone camera |
| Public API | Checks of the source and the linked artifacts found no private API; AppKit, WebKit and CoreImage are public system frameworks, and no Tauri private feature is used |

Data layer: 13 Python HTTP/SQLite integration tests.
Draft model: 8 Node tests.
Real WebKit: 12 flow assertions, covering the 10 items of the first phase and 2 after a real reload.
The commands are in [testing](../testing.md).

## Failures, blockers and fixed issues

- **Automatic real input injection was blocked**: `CGPreflightPostEventAccess()` returned false. The tests did not
  request or change TCC permissions, so no synthetic mouse or keyboard events were sent, and the flag tests were not
  marked as real click-through passes.
- The first native stack document view had no height, so the app-owned render was empty; after switching to explicit
  canvas and text frames, it was captured again and the content was confirmed correct.
- An independent review found a draft key shared across tabs, the first quota failure, an old WebView after switching
  the source, interrupted restore and a race while waiting for pairing; all were fixed and given matching regression
  checks.
- The first version of the WebKit test submitted the form before the module was ready and did not wait for
  asynchronous buttons, which caused false failures; after it was changed to wait for initialization and state, the
  rerun passed.
- The automated tests that ran to completion have no unfixed failures. The untested items below remain platform
  acceptance gaps.

## Not tested, not claimed as passed

| Item | How to verify next |
|---|---|
| Real mouse click-through | With the locked panel over desktop icons, click and double-click; rubber-band select on empty space; drag a test file across the panel. Confirm that the events reach Finder and that the note is neither text-selected nor moved |
| Layer order relative to icons | All three modes were actually started and verified for settings and data reception; the layering still needs a visual check against Finder icons and ordinary app windows. An app-owned PNG cannot prove the compositor's order |
| Updates while typing continuously | Keep typing in another editor while a second client changes a note; confirm that every character stays in the original app |
| Spaces, Show Desktop, Mission Control | Switch one by one, enter and leave the desktop, move between Spaces; record how the panel appears and recovers, and the focus |
| Stage Manager and full screen | Turn Stage Manager on and off, enter and leave full screen; check content occlusion and recovery |
| Multiple displays, scaling, hot-plugging | Connect a real second display, switch the primary display and hot-plug; test the panel's reachability and size; this run had only 1 display |
| Sleep and wake, real network outage | This run tested transport failure and DB restart; putting the whole Mac to sleep or disconnecting the router was not done |
| Browser offline cold start | The service worker provides an editor shell cache; a full offline restart of Safari and Chrome has not been tested. The native offline cache is readable; a cold-started editor still needs the server |
| Real phones, LAN TLS, internet | Once trusted HTTPS, phone trust and network reachability are prepared, scan the QR code and do pairing and revocation. A loopback QR code cannot be used by a phone directly |
| Other OS and CPU | Windows, Linux, Apple Silicon, iOS and Android have not been built or run; this Mac's results do not carry over |
| Stores and formal distribution | No formal signing identity, not notarized, no MSIX or phone package built, nothing submitted to the Apple, Google or Microsoft stores |
| UX user evaluation | This run tested operational correctness; no everyday usage feedback yet. Making notes stand out on this machine and multiple independent note windows are not implemented yet |

## Local operable delivery

The start script ran to completion and `http://127.0.0.1:9847` served requests; the normal app (not the probe) was
paired as admin successfully.
At initialization the data directory did not exist; only this app's `~/.work-fleet/` data was created, and no other
application's content was read or written.
There is also a local `build/work-fleet-validation-macos-x86_64.zip`; build artifacts are not committed to Git and can
be rebuilt from source.

## Reproducible evidence and images

- [Sandbox and WebKit run events](macos-web-probe.json): only synthetic data counts, states and assertion names; no
  tokens or note text.
- [Normal window probe](macos-normal-probe.json), [below-icons probe](macos-below-probe.json).
- [Desktop card render](desktop.png), [editor render](editor.png): captures of the app's own views only, with synthetic
  data; not screenshots of the user's desktop.

## Independent review

Another read-only reviewer checked the server, the drafts, native pairing, the probes and the fixes.
Independent fault injection rechecked the interrupted restore and the refusal of old credentials, and the final
recheck of the specified fixes found no new blocking issues.
The builds and tests the author ran were not treated as an independent review. Stores, production network security
and the full platform matrix have not been audited.
