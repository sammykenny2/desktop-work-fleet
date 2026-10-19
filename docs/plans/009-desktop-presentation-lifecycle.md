# PLAN-009: Desktop presentation lifecycle and core isolation

## Metadata

| Field | Value |
|---|---|
| Status | Draft; implementation not started or approved |
| Owner | Project maintainer |
| Assigned To | Unassigned |
| Reviewer | Independent reviewer not assigned |
| Date | 2026-10-20 |

## Related Spec

[SPEC-009](../specs/009-desktop-presentation-lifecycle.md), based on proposed
[ADR-058](../decisions/058-desktop-presentation-lifecycle-and-core-isolation.md).

## Overview

First resolve the service-runtime and process-boundary questions with isolated evidence. Then extract the shared
work authority, implement authenticated local clients, and integrate continuous readiness/recovery per native
platform. The Pi scenario must receive its own diagnosis; the Windows crash is not a substitute.

Only document drafting is currently authorized. The checkboxes below track implementation after approval;
creating these documents does not complete Phase 0. Keep execution status in this field and these tasks, with
per-change evidence in commit bodies. Do not introduce a session log or release-result bookkeeping.

## Implementation Phases

### Phase 0: Verify targets and resolve architecture prerequisites

- [ ] 0.1 Obtain the maintainer's approved readable Pi log location and verify installation/version, OS, display
  backend, RustDesk configuration and Guacamole protocol. Compare monitor off/on and each remote path without
  assuming the Windows error applies. Do not change the live display or end the remote connection implicitly.
- [ ] 0.2 Inventory DOM/browser dependencies in Workspace, InteractionController, FileSync, source reset,
  automatic backup, drafts, native crypto/transports and `src/app/main.js`; identify adapter boundaries and the
  public commands needed by the main window versus scenes.
- [ ] 0.3 Evaluate a nonvisual ES module runtime on Windows x64, Linux x64/arm64 and supported macOS architectures.
  Prove timers, crypto, module loading, native cancellation and a service loop without a GUI/display connection.
  Compare dependency size, licenses, security maintenance and package distribution; record the choice in ADR-058
  or a focused supporting ADR before adopting it. Resolve SPEC-009 Q01.
- [ ] 0.4 Define graphical-process grouping, graphical observer isolation, local endpoint authentication,
  child ownership and session handover policy. Verify MSIX child activation/data identity, Linux runtime/socket
  permissions, macOS packaging/signing and per-session constraints. Resolve Q02/Q04 before freezing contracts.
- [ ] 0.5 Review SPEC-009's proposed defaults, acceptance matrix and authority/exit guarantees with the maintainer.
  Mark accepted scope accurately and obtain implementation authorization; leave unresolved platforms explicit.

**Deliverables**: verified target facts, a chosen runtime with runnable nonvisual evidence, bounded IPC/process
contracts and approved implementation scope. Do not claim a hidden-WebView experiment proves isolation.

### Phase 1: Extract the resident work authority

- [ ] 1.1 Extract shared service bootstrap and scheduling from `src/app/main.js` without duplicating Workspace,
  InteractionController, FileSync or backup semantics. Supply explicit environment/clock/crypto/native adapters.
- [ ] 1.2 Move single-writer storage ownership and the command/draft queue into the core; keep current profile,
  account/source generations, reset/restore transactions, attachment limits, secure vault and V1 formats.
- [ ] 1.3 Keep sync, outbox and automatic backup eligible while no presentation exists; pause only operations
  requiring missing authorization, network or interactive permissions, with accurate durable status.
- [ ] 1.4 Add nonvisual startup/shutdown, explicit-exit cancellation and instance forwarding. Start no graphical
  toolkit as a side effect of imports, logging, locale resolution or environment observation.
- [ ] 1.5 Verify acknowledged drafts, lost acknowledgements, source/account changes and backup/sync continuation
  using existing semantic fixtures plus a real core process without a display connection.

**Deliverables**: one tested nonvisual service owner. The existing application remains the reference for
behavior; partial extraction is not acceptance of presentation recovery.

### Phase 2: Separate presentation and secure local IPC

- [ ] 2.1 Create the approved child-host entry points for main-window/scene presentation, retaining packaged assets,
  navigation restrictions, native layering and existing projection/command semantics.
- [ ] 2.2 Route UI requests through authenticated, bounded local IPC; distinguish management and scene roles.
  Bind replies and transfer leases to core/profile/session/presentation generations and retain durable acks.
- [ ] 2.3 Track verified owned children and teardown deadlines; reject duplicate registration, stale completion,
  unrelated/reused PIDs and unauthorized peers. On core death, children lose input and exit rather than claim data.
- [ ] 2.4 Keep drafts and model authority in the core; reconnect views from committed state, reconcile uncertain
  saves and checkpoint before planned release. Preserve ordinary resize/IME/editor reuse behavior.
- [ ] 2.5 Add process-boundary fault probes: child initialization failure, child death during sync/backup,
  stale profile replies, private IPC abuse and core shutdown with an unresponsive child.

**Deliverables**: replaceable presentation clients with measured failure containment and one storage authority.

### Phase 3: Add continuous presentation lifecycle

- [ ] 3.1 Implement the SPEC-009 state model with injected clocks/adapters, typed available/unavailable/unknown
  observations, material environment generations and per-capability readiness.
- [ ] 3.2 Serialize create/release work, fence stale completions, and invalidate input/focus immediately while
  coalescing geometry changes; apply SPEC-003 reachability and group-region rules after validation.
- [ ] 3.3 Implement bounded transient retry, fatal-failure latching, slow observation reconciliation and explicit
  Retry. Do not reset budgets on identical polling or allow elapsed time to bypass missing prerequisites.
- [ ] 3.4 Integrate planned checkpoint versus abrupt-loss handling, including failed saves and IME limitations;
  make core services independent of presentation waiting and recovery.
- [ ] 3.5 Add localized waiting/recovery status and bounded privacy-preserving transitions/errors. With no UI,
  keep diagnostic state for the next available UI without requiring a dialog.

**Deliverables**: deterministic policy and fault tests covering L01-L18's shared portions; native evidence remains
separate. This phase can be developed with fixtures while platform access is being arranged.

### Phase 4: Integrate and verify Windows

- [ ] 4.1 Refactor `Program`, `SingleInstance`, `FleetWindow` and `DesktopCoordinator` onto the approved core/client
  boundary. Move display, session and Explorer observations to the appropriate nongraphical adapter or child.
- [ ] 4.2 Replace sign-in-only forced attachment with continuous readiness, including eligible remote sessions
  whose physical-topology queries are unsupported. Fail isolated graphics initialization safely.
- [ ] 4.3 Remove whole-app reopen, restart-marker read/write, previous-process termination and obsolete reopen
  probes. Keep legacy markers inert and normal application activation functional.
- [ ] 4.4 Retain and retarget CrashGuard's detach-before-report probe to every Explorer-attached child; verify
  partial creation, nested failures and child termination without freezing Explorer.
- [ ] 4.5 Run isolated Windows native/core/UI/package checks and the Windows rows of the verification matrix.
  Verify child identity and private data paths in both MSIX and ZIP builds, without replacing the user's install.

**Deliverables**: Windows lifecycle acceptance and an explicit list of remaining device/session boundaries.
Windows completion alone does not close the Pi report.

### Phase 5: Integrate and verify Linux/Pi and macOS separately

- [ ] 5.1 Start the Linux core without GTK/WebKit or a display connection. Reconnect only a graphical child to the
  intended X11/Wayland session; distinguish display-server loss from an ordinary monitor/resolution change.
- [ ] 5.2 Preserve the existing labwc/X11/GNOME capabilities and Pi renderer defaults; restore supported layers,
  shortcuts and tray without assuming a remote session provides the local compositor's protocols.
- [ ] 5.3 Verify the Pi's actual RustDesk and Guacamole paths with monitor off/on, reconnect, geometry changes and
  abrupt backend/renderer loss, using isolated data and coordinated access. Record actual capabilities, not an
  inferred pass based on a different remote-access tool or headless Docker test.
- [ ] 5.4 Integrate the macOS core/presentation boundary with AppKit display/session events, menu bar, login item,
  window placement, signing and updater exit; keep focus/Spaces rules and editor reuse.
- [ ] 5.5 Run native Linux and Mac checks where available, and real-device acceptance per platform. Mark unavailable
  hardware/session checks as unverified; do not infer AppKit/Pi behavior from Windows probes.

**Deliverables**: independently accepted native adapters. Work on each platform can start once Phases 0-3 supply
its prerequisites; the numbered Windows phase is not permission to ignore Pi evidence gathering in Phase 0.

### Phase 6: Complete regression, documentation and independent review

- [ ] 6.1 Run the applicable existing JS/Python/native suites and new lifecycle/process tests; verify ordinary
  editing, source switching/reset, backups, restore, tray close, explicit Quit and update save/exit behavior.
- [ ] 6.2 Obtain an independent read-only architecture/security and implementation review; record findings and
  fixes in their implementation commits. Author-run checks do not count as independent review.
- [ ] 6.3 Update affected ADR status/supersession, SPEC acceptance, this plan's tasks, architecture, testing,
  security/services/deployment, platform READMEs and user guides as behavior lands. Update English and zh-TW user
  guides together; update PROGRESS only for changed project-level facts.
- [ ] 6.4 Report implemented, verified, unverified and unsupported boundaries per platform. Version bumps,
  installation and release workflow dispatch remain separate user-authorized tasks.

**Deliverables**: reviewed implementation with evidence mapped to SPEC-009 L01-L18 and accurate owning documents.

## Files to Create/Modify

These are expected touch points; new service/runtime/IPC paths are named after the Phase 0 decision, not invented
as completed components here.

| Existing area | Planned action |
|---|---|
| `src/app/main.js`, `src/app/automatic-backup.js`, `src/app/backup.js` | Separate UI controls from service construction and scheduling |
| `src/core/`, `src/sources/`, `src/backup/`, `src/desktop/`, `src/storage/native.js` | Add service adapters/client boundaries while retaining one semantic implementation |
| `contracts/desktop.d.ts`, `contracts/sync.d.ts` | Specify authority, lifecycle generations, capabilities and bounded local protocol |
| `src/native/windows/app/`, `src/native/windows/core/` | Nonvisual owner, graphical clients, native environment adapters and reopen removal |
| `src/native/linux/host.py`, `service.py`, `desktop.py`, `scenes.py`, `renderer.py` | Separate display-dependent initialization and reconnectable presentation from the core |
| `src/native/apple/Shared/`, `src/native/apple/macos/` | Desktop core/client adapters; preserve shared iOS code paths |
| `src/i18n/locales/`, native string tables | Waiting, recovery and actionable error text in all supported locales |
| `tests/`, `tests/native/windows/`, `scripts/testing/`, native build/package scripts | Behavioral tests, isolated process faults and packaged-child checks |
| `docs/architecture.md`, `docs/testing.md`, platform READMEs and affected owning docs | Current boundaries and actual verification as work lands |

## Technical Decisions

ADR-058 proposes one nonvisual core and disposable graphical clients. Q01/Q02/Q04 are prerequisites to an
implementation contract, not permission to introduce a preferred JavaScript engine, GUI rewrite or privileged
service. Use private local IPC and the current secure storage. Keep JSON data at V1 during pre-store testing.

Remove the dormant Windows reopen path as an independently testable change after implementation approval, while
retaining crash containment. That small change does not complete the core or readiness phases.

## Testing Strategy

- **Documentation now**: the repository's `check_docs.py`, `git diff --check`, scope checks and requirement/case/task
  consistency. No native-runtime claim follows from a passing documentation check.
- **Shared policy**: injected events, clocks and fault outcomes test attempts, latching, generation fencing,
  geometry reuse, checkpoint failures, stale sessions/profiles and stopped-state behavior.
- **Process integration**: real core and child processes with isolated stores verify durable acknowledgements,
  IPC role boundaries, writer ownership, continued sync/backup and containment of graphical termination.
- **Native/manual**: follow [testing](../testing.md#proposed-desktop-presentation-lifecycle-verification) and record
  each platform/session separately. Live remote access, display changes and disruptive fault injection require
  coordination; use synthetic hosts or disposable test sessions wherever possible.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A hidden browser remains the real authority | High | Start core without GUI/display initialization and continue services after killing every graphical child |
| A new JS runtime changes crypto/module/transaction behavior | High | Phase 0 compatibility and license evidence; reuse semantics and existing durable-operation fixtures |
| An observer dies with a lost display server | High | Keep that observer disposable; let the nongraphical core reconcile independently |
| Stale IPC crosses accounts or sessions | High | Authenticated roles, source/profile/session fences, bounded transfers and explicit handover policy |
| Child failures become an endless relaunch loop | High | Stable environment fingerprint, attempt budget and fatal latch; identical observations do not reopen it |
| Planned teardown loses drafts or IME | High | Reuse valid editors, durable checkpoints, save failure keeps viable editor, honest abrupt-loss boundary |
| Core keeps running after explicit exit | High | Cancel launches first and make stopped state final for that application lifetime |
| Windows evidence is mistaken for a Pi diagnosis | High | Obtain Pi evidence separately and verify its actual backend and remote paths |
| Packaging breaks helper activation or platform support | Medium | Validate signed/package identity and supported architectures before adopting the runtime/process boundary |

Created: 2026-10-20.
