# macOS login item status at first registration

Reviewed: 2026-10-15. Addresses the start-at-login option in Settings > Desktop being disabled in 0.2.3, and the wrong
"Applications" hint; run results are in the git history, and current status is in [PROGRESS](../../PROGRESS.md).

## Local evidence

- The installed 0.2.3 is at `/Applications/Work Fleet.app`, and the running main executable is also in that app.
- The Developer ID signature, Team, sandbox entitlement and notarization ticket are present.
- The production code performed the first default registration only on `notRegistered`, turned `notFound` into
  unavailable, disabled the switch and showed a hint to move the app to "Applications".
  That hint did not check the actual location, and did not receive any registration failure error.
- For a separate ad-hoc signed sandboxed app, the real `SMAppService.mainApp` first status is 3 (`notFound`);
  after the fix, the production host can register it to 1 (`enabled`), and after unregistering it is 0
  (`notRegistered`).
  A random `app.workfleet.loginprobe.*` identity is used; only its own login item is changed and removed, and the
  user's workspace is not touched.

## Official evidence and inferences

[Apple's status description](https://developer.apple.com/documentation/servicemanagement/smappservice/status-swift.enum/notfound)
describes `notFound` as the status when the framework cannot find the service, and does not say it means the app is
not in Applications.
An [Apple DTS reply](https://developer.apple.com/forums/thread/719862) explains that a service the system has never
seen can also return `notFound`, and becomes `notRegistered` only after registering and unregistering; that discussion
uses a helper login item, so whether it applies to the main app has to be verified with the actual `mainApp`.
The [register API](https://developer.apple.com/documentation/servicemanagement/smappservice/register%28%29)
lets the main app register and then launch at later logins, and may fail because of the user's approval state.

On this evidence, this project should not block registration on `notFound`. The fix accepts this first status, and a
failed actual registration is still reported as an error;
an existing preference does not automatically re-enable an item the user removed in the system, and turning it on
manually is still offered.
The system's background item database is not reset, and other apps' login items are not changed.

## Decision and verification boundaries

[ADR-043](../decisions/043-desktop-window-placement-and-startup-behavior.md) adds the status handling.
The production Swift host is regression-tested with an injected service, and there is also an opt-in real
register/unregister test with a unique sandboxed test app;
the commands and isolation are in [testing](../testing.md). These checks cannot count as acceptance of a real logout,
logging in again or a production install package.
