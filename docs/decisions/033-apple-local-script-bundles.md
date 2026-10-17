# ADR-033: Apple local script bundles

## Status

Accepted (Apple asset packaging fix), 2026-10-05.
Updates the Apple output format of ADR-009/ADR-029 without changing the source modules or the data contracts.

## Context

With a valid Apple Development signature and profile, the real Keychain and SQLite passed and WKWebView could load the local
HTML, but the `type="module"` main script failed to load and the main window stayed on the loading screen.
The resource error from an isolated fixture pointed to the packaged `app/main.js`; the bridge had not been set up yet.
The evidence and limits are in the [research note](../research/2026-10-05-apple-signed-startup-and-local-scripts.md).

## Decision

- Apple Prepare local resources uses esbuild 0.28.2, pinned by the lockfile,
  to bundle the shared main window and the desktop scene each into a browser IIFE, targeting Safari 16.
- Apple HTML uses a local classic deferred script and drops the import map and its CSP hash, which are no longer needed.
  CSP still allows only self scripts; the local file read-access scope and the main frame and document bridge checks stay
  unchanged.
- The sources, the other platforms and the default web build keep ESM; there is no runtime server and no new listener.
- Dependency legal comments, the original vendor files and the complete LICENSE are kept; esbuild is only a build tool.
- A development-signed fixture with a unique bundle identity actually verifies Keychain, SQLite and the bundled main window.
  The test does not touch the user's notes and removes the Keychain items it created when it finishes.

## Consequences

### Positive

The local WKWebView can complete native initialization; macOS and iOS share the same Apple packaging method and sources.

### Negative

The Apple build adds a pinned development tool and generated scripts; full iOS, Intel and desktop operation still need
real-device acceptance.

### Neutral

A valid signature and profile are still a precondition of the Data Protection Keychain; bundled scripts cannot replace signing
or notarization.

## Alternatives Considered

Keeping plain ESM: the local signed fixture already reproduced the startup failure.
Relaxing private WebKit file/CORS settings: does not fit the existing public API and limited-asset boundary.
Adding an HTTP listener: this is only an asset packaging problem, so there is no need for a resident service.

## References

- [ADR-009](009-local-renderer-and-persistence.md), [ADR-023](023-apple-native-host-and-scenes.md), [ADR-029](029-portable-apple-xcode-project.md).
- [esbuild bundling API](https://esbuild.github.io/api/#bundle).
- [Apple local asset loading](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:)).

*Decision made: 2026-10-05*
