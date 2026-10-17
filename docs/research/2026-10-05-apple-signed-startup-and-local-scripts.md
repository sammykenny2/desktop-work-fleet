# Apple development signing and local script startup

Reviewed and tested: 2026-10-05. This is evidence for the failed 0.1.0 trial install; current status is in
[PROGRESS](../../PROGRESS.md), with history and verification evidence in the git history and [testing](../testing.md).

## Local evidence

The earlier `CODE_SIGNING_ALLOWED=NO` build carried no valid entitlement, and updating a nonexistent item with the
Data Protection Keychain returned `-34018` (missing entitlement), which matches the "Apple Keychain could not be
updated" the user saw.
After the maintainer created an Apple Development certificate and registered the Mac in Xcode, the signature contains
the application identifier, team identifier, Sandbox and Keychain access group, and the profile allows registered
devices.

With a unique `app.workfleet.startupprobe.*` bundle, real FleetKeychain create/read/update and reopening the
FleetDatabase encrypted SQLite passed. The bundled HTML finished loading, but a module resource error pointed to
`app/main.js`, and the screen stayed on the loading screen with the native bridge not yet created. This is a second
problem, separate from Keychain signing.
After merging into classic deferred scripts, the same native host/desktop/renderer completed initialization.
The final probe did not replace the real bridge handlers; it read no user data and cleared only the probe's own
service.

## External evidence and inferences

The [Apple API](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:))
provides a way to load local assets with a specified read-access scope.
[WebKit issue 154916](https://bugs.webkit.org/show_bug.cgi?id=154916) records the cross-origin restrictions of the
file origin.
The local resource error supports the conclusion that loading the modules as-is is incompatible; it was not further
attributed to a regression in a specific WebKit version.
The [esbuild API](https://esbuild.github.io/api/#bundle) supports merging module dependencies into a browser script;
a fixed version was chosen, legal comments/the full LICENSE are kept, and the result is verified by a real WKWebView.

## Decisions and limits

[ADR-033](../decisions/033-apple-local-script-bundles.md) changes only Apple packaging; it does not relax the CSP,
bridge or Sandbox, and introduces no local HTTP server. An Apple Development profile is not the same as
Developer ID/notarized distribution across machines. Real Intel hardware, iOS, Google sign-in, IME/Spaces and full
desktop operation are still not accepted.
