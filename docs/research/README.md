# Research index

Updated: 2026-10-17.

## Latest design: read first

- [Mobile Google sign-in](2026-10-17-mobile-google-sign-in.md): OAuth clients, the Android Web audience / local account selection state, Apple cancellation that keeps the existing sign-in, and the limits of simulated testing.
- [Linux Secret Service without active prompts](2026-10-15-linux-secret-service-without-prompts.md): persistent collection, immediate locking / secret reads, provider search prompts and the limits of private keyring validation; decision in ADR-048.
- [Public release feed and company egress IP quota](2026-10-15-public-release-feed-without-api-quota.md): the official unauthenticated REST API quota, a same-machine test, and the decision limits of switching all three platforms to read Atom.
- [Main window position, startup behaviour and app update reference](2026-10-14-desktop-window-startup-and-update-reference.md): behaviour and design lessons from an Electron reference project, and this project's current state; recommendations in ADR-043/044.
- [macOS login item first registration](2026-10-15-macos-login-item-first-registration.md): `notFound` is no basis for stopping registration or for judging where the app is installed; production host regression and the limits of sandbox testing.
- [Desktop card requirements evolution](2026-10-04-desktop-card-interaction-design.md): user confirmations, additions and superseded approaches.
- [Cross-platform interaction feasibility](2026-10-04-desktop-interaction-platform-feasibility.md): Win/Mac/labwc capabilities, evidence and renderer limits.
- [Desktop layer follow-through](2026-10-05-desktop-layer-reference-follow-through.md): the checked reference native results, Pi fixes and the boundary of this product's own validation.
- [Apple signing and local script startup](2026-10-05-apple-signed-startup-and-local-scripts.md): Keychain entitlement, module load failures and validation of starting the real native host.
- [Windows native storage and WebView](2026-10-04-windows-native-storage-and-webview.md): official security boundaries, SQLite/DPAPI and the real UI probe scope.
- [Windows transparent scenes and input](2026-10-04-windows-composition-and-input.md): composition, cross-process hit testing, region occlusion, shortcuts/DPI and the targeting-pack license.
- [Windows shortcuts and tray](2026-10-04-windows-shortcuts-and-tray.md): foreground conditions, the public shell icon API and the acceptance limits for physical input.
- The development contract is [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md);
  the entry point is the [handoff document](../handoff/2026-10-04-desktop-interaction-handoff.md).

## 2026-10-03 historical research reading order

1. [Backlog-first requirements and evolution](2026-10-03-backlog-first-product-requirements.md)
2. [Mainstream lightweight PM and view model](2026-10-03-lightweight-project-management-and-view-model.md)
3. [Source of truth, sync and conflicts](2026-10-03-source-of-truth-sync-and-conflict-analysis.md)
4. [macOS public API desktop display](2026-10-03-macos-public-api-desktop-feasibility.md)
5. [Store distribution, Linux scope and licenses](2026-10-03-store-distribution-and-license-analysis.md)
6. [Independent architecture and validation plan](2026-10-03-independent-architecture-and-validation-plan.md)

## Design after the validation prototype

The source direction keeps the [Google Drive notes MVP](2026-10-03-google-drive-notes-mvp-feasibility.md):
1.0 starts with a Google account + file-based notes, with no local server, keeping the source and renderer abstractions.
Keep's official API limits, the Drive storage choice, conflicts and the sign-in/store work all have sourced evidence.

The [full product architecture draft](2026-10-03-product-architecture-blueprint.md) and ADR-003 are marked Deferred,
keeping the design for a future PM/self-hosted server. For the 0.1.0 current state, see the architecture entry point and the validation report.

The [AppData backup and restore design](2026-10-03-appdata-backup-and-restore-design.md) adds official file capabilities,
a source-independent format, offline snapshot limits and safe import semantics, and links to SPEC-002/PLAN-002.

[Drive file transport](2026-10-04-drive-file-transport.md) checks appDataFolder, paging, pre-generated IDs,
resumable uploads and integrity; the decision is in ADR-012, and scripted transport was not taken as real Google evidence.

[Backup container and encryption](2026-10-04-backup-container-and-encryption.md) checks ZIP, DEFLATE, WebCrypto,
KDF and dependencies; the full scope and the three restore modes are in SPEC-002/ADR-013, and earlier format exclusions no longer apply.

[Automatic backup file safety](2026-10-04-automatic-backup-file-safety.md) records FSA locators / file-replacement races,
and separates scheduler/real IDB evidence from native file capabilities still to be implemented; decision in ADR-014.

## How to read

[Windows scene coordination](2026-10-04-windows-desktop-coordination.md) distinguishes physical/logical coordinates,
the public ZoomFactor and restricted multi-window transport, and the validation limits of real DOM/native input; decision in ADR-018.

[Windows native backup](2026-10-04-windows-native-backup-files.md) records the official sources and validation limits for RootDirectory/reparse/
file identity cleanup and .NET portable encryption; decision in ADR-016.

- **User requirements**: intent and constraints the user has stated explicitly in conversation.
- **External evidence**: verifiable information from official documentation or local sources, with the date consulted.
- **Inference/candidate**: research suggestions; they do not mean the user has adopted or selected them.
- **Unverified**: not yet validated on real hardware, in integration, in sync or in store review.
- **Done**: used only for work that was actually carried out and has a result. Current status is in [PROGRESS.md](../../PROGRESS.md);
  history and verification evidence are in the git history and [testing](../testing.md).

The latest product focus is quick capture and seeing unfinished items. Agent execution management, more states and GitHub Projects as the authoritative source were only candidates under discussion and must not be treated as decided requirements.

## Document conventions

- File name: YYYY-MM-DD-topic-in-kebab-case.md.
- The date is the actual date of the research/write-up, not a date taken from a user's example.
- Put source links next to the conclusions they support; when re-consulting a source, note the date and what changed.
- Do not copy large amounts of other products' documentation, code or assets.
- Use relative paths; never write absolute paths from a personal machine.
- Keep research and decisions apart; Accepted decisions go in [decisions](../decisions/README.md).
