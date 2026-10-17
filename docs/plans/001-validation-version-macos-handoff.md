# Validation Version macOS Handoff Plan

Updated: 2026-10-03.
Status: the validation version was implemented after this handoff; the "at handoff" content below is kept as the historical baseline. Results are in the [validation report](../validation/2026-10-03-validation-report.md); the current project status is in PROGRESS.md.
Goal: deliver a version that can verify the concerns raised earlier.

This document sets the order in which the same goal continues on macOS. A document handoff does not count as product delivery.

## 1. Authoritative state at handoff

- Repository: sammykenny2/desktop-work-fleet, a private GitHub repo, default branch main.
- Done: minimal bootstrap, six research documents, requirements history, initial decisions, source and license notices.
- Original baseline: 12acae6; this document and the index updates add later commits, so the actual HEAD is authoritative.
- No product app, server, dependency lockfile, formal technology choice or platform probe exists yet.
- On Windows, Node 24.21.0, pnpm 12.4.2 and Rust 1.99.0 were confirmed available. These describe that environment and are not version requirements for the Mac.
- On Windows, the upgrade-project skill and the vite-react flavor were read; the updater was not run and no dependencies were installed.
- The bootstrap source was not modified, and no content from other sticky-note apps was copied.
- The user agreed to continue on the Mac and asked for a goal description that can be used directly.
- The user explicitly authorized committing and pushing the current work directly to main; do not create a PR or feature branch.
- The current status is in the root PROGRESS.md; history is in the git history.

## 2. Read before starting

1. AGENTS.md, your own agent file, docs/AGENT-GUIDE.md.
2. docs/README.md, PROGRESS.md, docs/decisions/001-independent-backlog-first-foundation.md.
3. docs/research/2026-10-03-backlog-first-product-requirements.md.
4. docs/research/2026-10-03-source-of-truth-sync-and-conflict-analysis.md.
5. docs/research/2026-10-03-macos-public-api-desktop-feasibility.md.
6. docs/research/2026-10-03-store-distribution-and-license-analysis.md.
7. Read the other research and architecture candidates as the current work requires.

First confirm the local and remote HEAD, working-tree changes, Xcode / Command Line Tools, available SDKs and the signing method. Keep the user's existing work; do not assume it can be overwritten.

There is no need to ask again whether implementation may start; the current goal already requires delivering the validation version.

## 3. Product focus

The user treats notes as a backlog, mainly looks at unfinished items, and wants to capture ideas quickly when they come. Keep the default operations simple: text, to-dos and Todo / In Progress / Done. Do not turn agent execution status, assignment, scheduling, estimates or owners into a required workflow.

Each machine can show the same set of shared notes and highlight what is relevant to that machine. The desktop is normally read-only and passes the mouse through; when needed, the user can unlock it, edit in place and lock it again. Web and phones have their own editing entry.

Machines and agents are usage contexts; they should not dominate the first version's information architecture.

## 4. Suggested implementation order

### A. Rule out macOS platform risk first

Create a small, independent AppKit probe in the new repo. Start with solid-colour cards, use only public APIs and enable App Sandbox.

It needs:
- A control / unlock entry that is always reachable.
- A presentation window near the desktop that ignores the mouse and does not become the key window while locked.
- Comparable presentation modes: normal window, above the icons, below the icons.
- Data that can be updated, not just a fixed image of text.
- Restored input and focus policy after unlock / edit / lock.
- Diagnostic output that records settings and results without leaking tokens or private notes.

First build, actually launch and verify at least "receive data, read-only presentation, mouse pass-through, no focus stealing". Then test the full Spaces / Show Desktop / multi-display / sleep matrix.

If the wallpaper layer fails, record the specific failure and the desktop layer that does work; do not add private APIs to make it succeed. AppKit success on its own does not mean Tauri integration succeeds.

### B. Deliver a backlog that can be saved and synced

Use the smallest working design: notes, text / to-dos, quick add, edit, simple status, complete / restore, and presentation of shared data.

The implementation previously proposed as first choice is React + TypeScript, Rust + Axum and local SQLite on the server; Tauri 2 is the candidate shared app shell. None of these is recorded as an Accepted technology decision yet. They may be adopted on the evidence found, with the reasons, versions and licenses recorded in an ADR.

Use one authoritative data source. Implement cross-device conditional updates, persistence, retry deduplication, delete semantics, reliable drafts, offline reading and reproducible backup / restore. A demo where each browser keeps its own isolated localStorage is not enough.

If a local server is used, add revocable device access and short-lived, one-time QR pairing; the QR code must not contain a permanent admin secret. Describe LAN and internet reachability separately.

### C. Connect a real vertical flow

Phone or second browser captures → server saves → macOS card updates → unlock and edit → other clients update.

Receiving data on the desktop must not steal focus from the app in use; lock is a mode that prevents accidental touches, not a cross-device data lock.

### D. Provide verification paths for the remaining concerns

The original platform targets Windows, Linux, iOS and Android remain. Provide the matching build / packaging checks, test steps and result fields; run them in whatever environments are available, and do not extend Mac results to other operating systems.

On Windows, evaluate Store MSIX first; the user does not plan to buy a commercial signing certificate. For Linux, list the distro / CPU / desktop or compositor explicitly and do not claim full compatibility. The Apple / Google store targets remain; trial builds and formal store review are separate.

## 5. Evidence needed for completion review

| Concern | Evidence to obtain |
|---|---|
| Does quick capture become tedious? | An operable add, organize and review flow; no extra required fields |
| Is it only a fake demo? | The full result of a real data source update reaching the presentation side |
| Do two simultaneous edits overwrite each other? | A reproducible concurrent-write test; the losing side's draft can be recovered |
| Does a retry after a lost response create duplicates? | After retrying the same operation, only one record exists |
| Do deletes / reconnecting offline devices resurrect data? | Behaviour tests for tombstones / conflicts or an equivalent design |
| Are persistence and recovery reliable? | Content survives a restart; after a backup restore, old clients do not silently overwrite it |
| Do permissions and pairing work? | Short-lived / one-time invitations, read-only restrictions, access denied after revocation |
| Does macOS really pass the mouse through? | Observation of clicks, rubber-band selection, dragging and focus on a real desktop |
| Do updates steal focus? | A test that updates cards while typing in another app |
| Are private APIs avoided? | A check of the source, dependency features, release settings and build artifacts |
| Is the sandbox effective? | Actual entitlements, sandboxed launch and network tests |
| Are platform differences hidden? | OS / version / hardware / desktop environment and each result listed |
| Can the licenses be shipped? | Pinned dependency versions, a complete license inventory, required notices and sources |
| Can others reproduce it? | Commands from a clean checkout, a launchable artifact, test steps and recorded results |

"Not yet tested", "failed" and "unsupported" must all be listed and never turned into a pass automatically. A successful build does not prove the desktop layer, gesture pass-through or store approval.

The goal is to deliver a version that can verify the concerns, not to promise that every experiment succeeds. If a required capability cannot be achieved, deliver reproducible evidence and a workable alternative; do not claim completion by deleting acceptance items.

## 6. License and work boundaries

- Do not copy large amounts of code, UI or assets from other apps; reusing general technical concepts is not reusing an implementation.
- Check the license before adding a dependency, and check the final actual dependency tree, not only the root LICENSE.
- Do not use macOS private APIs to work around failed platform validation.
- Do not buy certificates, create store accounts or submit for formal store review automatically.
- Keep the app's local data and signing secrets outside the repo; do not read or write other apps' real data.
- After appropriate tests and independent review, commit and push directly to main as authorized.
- Do not treat a document handoff, a single green check or tests that cannot cover the requirements as completion of the whole goal.

## 7. Goal description ready to paste

> In the private repo sammykenny2/desktop-work-fleet, continue the goal "deliver a version that can verify the concerns raised earlier". First read AGENTS.md, docs/README.md, PROGRESS.md and docs/plans/001-validation-version-macos-handoff.md, then start implementing from the current Git state instead of staying in planning.
>
> The product centres on a sticky-note backlog and quick capture, and keeps the simple Todo / In Progress / Done experience. First build and actually run, on this Mac, a desktop presentation probe that uses only public APIs and enables App Sandbox, and verify receiving data, read-only display, mouse pass-through, no focus stealing and unlock-to-edit. Then connect a note editing interface that saves and a real sync source, and verify simultaneous edits on several devices, disconnection / retry, draft preservation, deletion, backup restore and device permissions / QR pairing.
>
> Keep the direction of Windows / Linux desktops and Apple / Google first-party apps in stores, and provide an executable verification method and platform result for each item; never treat a successful build on one platform as all features passing. Check the license of every dependency first, do not bring in large amounts of code or assets from the old app, do not use private APIs, and do not introduce agent scheduling or complex status as the default UI.
>
> Keep going until the version has reproducible builds, operable verification, tests and a result report, recording verified, failed, not yet tested and remaining work separately. Commit and push directly to main without creating a feature branch or PR. Do not claim the goal is complete for any item without actual evidence.

## References

- [Research index](../research/README.md)
- [Latest requirements](../research/2026-10-03-backlog-first-product-requirements.md)
- [Project status](../../PROGRESS.md)
