# ADR-023: Apple native data, authorization and desktop scenes

## Status

Accepted, 2026-10-05. Implementation added; no Apple SDK or device results were obtained.

The wallpaper layer, the three layers and the 48-scene capacity are updated by [ADR-031](031-macos-and-linux-wallpaper-scenes.md).

## Context

The full 1.0 includes native macOS and iOS apps. The shared renderer already has notes, attachments, backup and restore,
and FileSync. It needs Apple secure storage, native Google authorization, protected file flows and single-owner desktop
interaction on macOS.
The user asked to prioritize implementation and to stop adding tests and reviews; the missing SDK on this machine must not be
used to shrink the delivery scope.

## Decision

- Swift/AppKit/UIKit/WKWebView; shared SQLite, Keychain AES-GCM, a unique owner lock,
  staged transfers and revision CAS. Nothing outside the packaged document has bridge rights; network access goes through
  restricted native HTTPS.
- GoogleSignIn 9.2.0 via SPM; macOS and iOS each get an iOS-type client that matches the bundle ID.
  The SDK handles system authorization and Keychain credentials; native code checks the stable identity with the HTTPS
  userinfo sub. The renderer only gets public account metadata and fixed FileStore operations; resumable upload URLs and
  tokens stay native.
- Native backups use a user-selected folder bookmark and security scope, directory and file identities, new-file creation,
  fsync and read-back verification, and journal-safe cleanup; portable encryption keeps the SPEC-002 PBKDF2/AES-GCM format.
- On macOS, each display has shared desktop/floating visual surfaces; only the main window saves content.
  The visual panel always passes input through; approved paper input regions use a transparent NSPanel that forwards native
  mouse events to the same WKWebView, clipped by the papers in front. Everyday pass-through cards create no input region;
  read-only text selection does not allow content changes.
- Public CGWindowLevelKey/NSWindow levels; two layers, desktop and floating. The wallpaper setting is kept, with an explicit
  desktop fallback. Background frames do not call activate; shortcut and local input intents have deadlines and foreground
  identity checks.
- Carbon RegisterEventHotKey; while the app or the editor has focus, the global registrations are released and the renderer
  handles local keys. The menu bar and the close flow save drafts and wait for the owner's confirmation; a cancelled close can
  be retried. Since 2026-10-06 the macOS window close button hides the app to the menu bar; quitting uses the menu item
  "Save and quit" or Cmd+Q.
- Display, Space and sleep notifications first pause input and revoke intents; the owner saves a rescue layout, then applies
  the new topology, keeping the editing WKWebView, with at most 16 displays and 32 active or retained scenes.
- How the Xcode project, shared schemes and the app's own icon asset catalog are produced is updated by
  [ADR-029](029-portable-apple-xcode-project.md): they are in Git and open directly after a clone.
  Node only maintains the project structure; local assets and public configuration are generated at build time. Signing
  secrets stay in Keychain, and dependency licenses are copied before the bundle is signed.

## Consequences

Shared content and backups keep one contract across platforms; Apple Keychain and SQLite do not rely on a Python server.
The Google Apple SDK and Keychain need Apple signing configuration; an unconfigured simulator is not claimed to support
sign-in.
The current Windows work environment has no Xcode: Swift was not compiled, no app or archive was built, there was no real
sign-in and no native gesture acceptance.
Input forwarding, IME, visual transparency, and the actual behavior with full screen, Spaces and Stage Manager still need
evidence from an Apple environment.
The store privacy form, signed export and upload wait until the accounts and settings are ready; listing text or manifests are
not presented as a completed submission.

## Alternatives Considered

Keeping the validation server does not meet the 1.0 requirements for file sources and secure authorization. The private
WKWebView background property is not used; transparency uses the public underPageBackgroundColor. A separate data owner per
card would break atomic saves and the draft boundaries.

## References

- [SPEC-003](../specs/003-desktop-cards-groups-and-formation.md), [ADR-018](018-single-owner-desktop-views.md).
- [Native build and status](../../src/native/apple/README.md).
- [Google Apple SDK integration](https://developers.google.com/identity/sign-in/ios/start-integrating).
- [Google 9.2.0](https://github.com/google/GoogleSignIn-iOS/releases/tag/9.2.0).
- [WKWebView public background](https://developer.apple.com/documentation/webkit/wkwebview/underpagebackgroundcolor).
- [AppKit mouse transparency](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents).

*Decision made: 2026-10-05*
