# ADR-029: Portable Apple Xcode project that opens directly

## Status

Accepted, 2026-10-05. The user asked that a clone on a Mac can be opened directly in Xcode.

## Context

The original generator wrote the Xcode project into the Git-ignored build/apple and used the generating machine's absolute
source paths.
As a result, a clone on a Mac had no project that could be opened directly, and files generated on Windows could not be moved
over.
Android already has a committed IDE project; both should be delivered the same way in a checkout.

## Decision

- `src/native/apple/WorkFleet.xcodeproj`, the workspace, the iOS/macOS shared schemes, the icons and the default xcconfig are in Git.
  Sources, resources and entitlements use paths relative to SOURCE_ROOT/SRCROOT; the project contains no machine paths and no
  `.env` values.
- Opening the project in Xcode does not need Node to generate it first; the Prepare local resources phase of Run/Build
  automatically runs the npm lockfile install and generates the web assets, public configuration and Info.plist. Each
  target's output is in the ignored `.generated/<target>/`; the phase declares its outputs so that resource copying and
  Info.plist processing depend on their generation, and every preparation picks up `.env` and source changes.
- The Share Extension only generates its Info.plist; it does not install npm or package the main app's configuration, Google
  identity or workspace data. The main app still embeds the Extension; the native data and sharing contracts follow
  ADR-023/ADR-027.
- The IDE's app ID, App Group and Team are controlled by the default xcconfig and the ignored Local.xcconfig;
  public Google and store fields are read from `.env`. The generated configuration uses the effective Xcode identity, so it
  cannot disagree with signing. The CLI wrapper uses the same project, and a non-empty identity in `.env` can override it; the
  wrapper does not rewrite the user's IDE project.
- Xcode user-script sandboxing is off, for the Node/npm bootstrap, reading local configuration and external tool paths.
  This setting concerns only the build tools; App Sandbox, Keychain and entitlements are kept.
- The structure generator only maintains the committed project; DerivedData, archives, exports and the npm cache stay in
  build/apple.

## Consequences

### Positive

A clone on a Mac can open the project directly; moving the checkout needs no source path fixes, and signing and local
configuration stay out of Git.

### Negative

Builds need Node 22+ and npm, and the first build downloads npm and SPM dependencies; adding a Swift source requires
maintaining the project references.
This machine has no Apple SDK, so portability and asset checks do not stand for Xcode compilation, device or signing
acceptance.

## Alternatives Considered

Keeping the ignored generated project: does not meet the explicit requirement that a clone opens directly.
Committing the project generated on Windows with absolute paths: it cannot be used on another Mac and would carry machine
configuration.

## References

- [Apple project notes](../../src/native/apple/README.md), [Current status](../../PROGRESS.md).
- [Apple Run Script phases and input/output dependencies](https://developer.apple.com/documentation/xcode/running-custom-scripts-during-a-build).
- [Apple build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference).

*Decision made: 2026-10-05*
