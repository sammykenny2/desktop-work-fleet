# 2026-10-05 Android native host

## Official evidence

- [WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit): pinned at 1.16.0.
- [AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes): 8.13.2, Gradle 8.13, JDK 17.
- [Authorization](https://developer.android.com/identity/authorization): authorization for Google data is separate from account sign-in; AuthorizationClient provides the access token/resolution. The documentation's dependency example is Play Services Auth 22.0.0.
- [Google ID releases](https://developers.google.com/identity/android-credential-manager/releases): Credential Manager's explicit Google button flow; this slice pins the compatible version Google ID 1.1.1.
- [WebMessage listener](https://developer.android.com/reference/androidx/webkit/WebViewCompat): fixed origin and main-frame verification; no global JavaScriptInterface is used.

## Decisions and boundaries

The implementation choices are in ADR-022. This official API evidence does not mean native compilation/real
devices/the Google project have been accepted.
This machine lacks the Android SDK/Gradle; execution evidence is in the git history and [testing](../testing.md), and
current status in [PROGRESS](../../PROGRESS.md).
