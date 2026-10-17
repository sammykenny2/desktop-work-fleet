# desktop-work-fleet

Traditional Chinese: [README.zh-TW.md](README.zh-TW.md)

Work notes and a lightweight backlog synced across devices: one card per thing, quick capture of ideas, and unfinished
work that stays in view.

## Current Status

- Current state by area, verified and unverified boundaries and open items: [PROGRESS.md](PROGRESS.md).
  Changes per version: [release notes](docs/release-notes.md). Order of future work: [ROADMAP](ROADMAP.md).
- **Before developing, read the [desktop interaction handoff](docs/handoff/2026-10-04-desktop-interaction-handoff.md)
  and [SPEC-003](docs/specs/003-desktop-cards-groups-and-formation.md)**. They separate confirmed requirements, working
  defaults, open questions and the 48 acceptance cases; the full reading order is in [Getting started](#getting-started).
- Platform caveats are in the platform READMEs under `src/native/` (for example [Linux](src/native/linux/README.md)).
  Model tests do not replace native desktop, real sync or store evidence, and the
  [0.1.0 validation report](docs/validation/2026-10-03-validation-report.md) keeps its original scope.

## Product direction

- One card per thing, organized in groups; the local device can highlight "mine", and groups are not hard-coded as
  machines.
- At most nine groups; formation uses rows × columns, with at most three rows and four columns and no more than nine
  regions in total.
- Normally read-only and click-through; a shortcut activates one group or all groups, which temporarily float above
  ordinary apps.
- Single click selects, double click edits; an ordinary drag only moves a card, and only a group label, a Shift drag or
  a card action changes its group.
- After free placement, only an explicit formation recalls, stacks or spreads cards; cycling only changes the temporary
  stacking order.
- Paper size normally stays the same; formation resizes papers only with consent, without consent they may overflow the
  group region, and undo is available.
- Shared content is kept apart from each device's layout, leaving room for future heterogeneous sources, renderers and a
  lightweight PM view.
- Our own iOS, macOS and Android apps keep the Apple and Google store targets; no Focus, Pomodoro or review features.

## Getting started

1. [Handoff entry and rules for obtaining reference material](docs/handoff/2026-10-04-desktop-interaction-handoff.md)
2. [Document index](docs/README.md) and [requirements](docs/requirements.md)
3. [Interaction specification](docs/specs/003-desktop-cards-groups-and-formation.md)
4. [Accepted semantics](docs/decisions/006-card-group-and-formation-semantics.md) and
   [presentation architecture proposal](docs/decisions/007-desktop-scene-and-platform-host.md)
5. [Implementation plan](docs/plans/003-desktop-interaction-implementation.md)
6. [Platform capability research](docs/research/2026-10-04-desktop-interaction-platform-feasibility.md) and
   [research index](docs/research/README.md)

The specifications in this repository do not depend on a fixed location of another checkout; when native desktop work
needs the auxiliary reference, ask the maintainer first.

## Preview the new local UI

```bash
npm ci --ignore-scripts
npm run build
python scripts/testing/serve_preview.py --port 0
```

Open the URL the terminal prints. The preview only serves static files; notes and attachments are stored in the
browser's IndexedDB. It is not connected to Google and is not the native layered desktop version. A fixed port keeps
the data of the same browser origin. Do not use this preview in place of backups; see
[ADR-009](docs/decisions/009-local-renderer-and-persistence.md).
The interface is English or Traditional Chinese: "Auto-detect" follows the browser's languages, and Settings > General >
Display language changes it ([internationalization](docs/i18n.md)).

## Build the Android app

In Android Studio, choose **Open** and select `src/native/android`. After Gradle Sync, choose `app` / `debug` and Run or
Build APK. It needs Node 22+ (with npm), JDK 17 and Android SDK 36; the project includes the Gradle Wrapper, and the build
installs the npm dependencies and generates the UI assets automatically.
You can also run `gradlew.bat assembleDebug` in that folder; the APK is at
`app/build/outputs/apk/debug/WorkFleet-<versionName>-android-debug.apk`.
See the [Android project notes](src/native/android/README.md).

## Open iOS / macOS in Xcode

On a Mac, clone the full repository and open `src/native/apple/WorkFleet.xcodeproj` directly, then choose
`WorkFleetIOS` or `WorkFleetMac`. The project, schemes and icons are in Git and use relative paths. With Node 22+ and
npm installed, the Xcode build prepares the UI assets automatically.
Your personal identity and Team go in the ignored `src/native/apple/config/Local.xcconfig`; see the
[Apple project notes](src/native/apple/README.md).

## Run the existing 0.1.0

On macOS:

```bash
bash scripts/macos/start-validation.sh
```

In the menu bar, WF > Quick capture / Unlock opens the editor, and WF > Lock returns to the presentation (the 0.1.0
prototype's interface is English only).
This is the validation version's flow; it does not include the group operations above or Google sign-in.
Build, pairing and backup steps are in the [setup guide](docs/setup-guide.md); checks are in
[testing](docs/testing.md). This version needs no pip or npm runtime packages; the 1.0 apps use the native hosts in `src/native/` instead.

## Project structure

```text
docs/research/      Research named by date and topic
docs/decisions/     Accepted, proposed and deferred decisions
docs/specs/         Behaviour specifications and acceptance cases
docs/plans/         Implementation order and delivery conditions
docs/handoff/       Handoff and rules for obtaining reference material
src/app/            1.0 shared local UI
src/core/           Atomic commands for cards, groups, drafts and the outbox
src/i18n/           Locale catalogs and the text helpers (see docs/i18n.md)
src/layout/         Per-device positions, formation and undo
src/interaction/    Operation scope and drag and drop
src/storage/        Partitioned IndexedDB transactions and attachments
src/native/android/ Android Studio / Gradle project and the Android native host
src/macos/          Existing AppKit sandbox presentation and WebKit editor entry
src/server/         Existing Python standard-library HTTP + SQLite validation service
src/web/            Existing shared note editor
tests/              Existing data, draft and WebKit tests
scripts/            Build, launch, probe and maintenance scripts
```

## Sources and licence

This project is designed independently and does not bring in product code or assets from other sticky-note apps.
The skeleton uses the maintainer's own project template (MIT); its source and scope are in
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md).
The initial licence is [MIT](LICENSE). Each third-party component added later needs its licence and per-platform
distribution obligations confirmed.
Referring to auxiliary reference material by a neutral name does not replace the source and legal notices that a
component actually adopted requires.
