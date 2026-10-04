# Third-party notices

Updated: 2026-10-04.

## project-bootstrap

- Source: [sammykenny2/project-bootstrap](https://github.com/sammykenny2/project-bootstrap).
- Revision used: a7438cf81d44519db89d2783dc14b7cfc9e0e851.
- Composition: templates/base via the minimal preset.
- Scope: shared agent instructions, agent-specific template files, documentation scaffolds, configuration defaults, and maintenance helper scripts.
- Source license: MIT.
- Original copyright line supplied by that checkout: Copyright (c) 2025.
- The original line and complete MIT permission/disclaimer text are retained in [LICENSE](LICENSE). The new project adds a separate notice for its original contributions.

Project-specific research and documentation were written for desktop-work-fleet. External references in the research are citations, not bundled product code.

No product code, images, fonts, dependency lockfiles, platform modules, or user data were imported from another sticky-note application.

## 1.0 renderer under development

The repository's package-lock.json pins the following packages. `npm run build`
copies only the three runtime ESM modules into `build/app/vendor`, retaining their
copyright headers and complete upstream LICENSE files. No fonts, images, CDN
scripts, browser binaries or application assets from another product are bundled.

| Package | Version | Purpose | License / source |
|---|---|---|---|
| marked | 18.0.14 | Runtime Markdown parsing | MIT; [MarkedJS](https://github.com/markedjs/marked) |
| dompurify | 3.4.16 | Runtime DOM sanitization | Apache-2.0 option of its Apache-2.0 OR MPL-2.0 license; [Cure53](https://github.com/cure53/DOMPurify) |
| fflate | 0.8.3 | Runtime ZIP writing / DEFLATE compression | MIT; [101arrowz/fflate](https://github.com/101arrowz/fflate) |
| @types/trusted-types | 2.0.7 | DOMPurify type dependency, not bundled | MIT; [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/trusted-types) |
| @playwright/test, playwright, playwright-core | 1.63.0 | Development browser tests, not bundled | Apache-2.0; [Microsoft Playwright](https://github.com/microsoft/playwright) |

Marked copyright: (c) 2018+, MarkedJS; (c) 2011–2018, Christopher Jeffrey.
DOMPurify copyright: Cure53 and other contributors. The source ESM files are copied
without modification. fflate copyright: (c) 2026 Arjun Barrett; its browser ESM is copied
without modification; application configuration is separate. The build includes
`marked-LICENSE.txt`, `dompurify-LICENSE.txt`, `fflate-LICENSE.txt` and this notice. Platform packages must
retain those files and the project's LICENSE. Final native SDK and store-package
inventories remain separate release work.

## Windows native host under development

NuGet `packages.lock.json` files pin versions and SHA-512 package content hashes.
The native output retains complete upstream license/notice files from `src/native/licenses`.
The framework-dependent app requires the user's .NET 8 Desktop Runtime and Evergreen
WebView2 Runtime; those full runtimes and the .NET SDK are not bundled.

| Package | Version | Scope / license |
|---|---|---|
| Microsoft.Web.WebView2 | 1.0.4258.31 | WPF/Core managed assemblies and WebView2Loader; Microsoft SDK license, complete LICENSE and NOTICE from this exact NuGet package |
| Microsoft.Data.Sqlite / .Core | 10.0.12 | SQLite provider; MIT, [upstream tagged license](https://github.com/dotnet/efcore/blob/v10.0.12/LICENSE.txt) |
| SQLitePCLRaw.core, .bundle_e_sqlite3, .provider.e_sqlite3, .lib.e_sqlite3 | 2.1.12 | SQLite binding/native package; Apache-2.0, Copyright 2014–2024 SourceGear, LLC; [tagged license](https://github.com/ericsink/SQLitePCL.raw/blob/v2.1.12/LICENSE.TXT) |
| System.Memory | 4.5.3 | Transitive package (framework supplies runtime on net8); MIT and incorporated notices from its exact NuGet package |
| Microsoft.Windows.SDK.NET.Ref | 10.0.19041.56 | Windows SDK targeting pack, explicitly pinned via WindowsSdkPackageVersion; projection/runtime DLLs redistributed unmodified under the [official SDK list](https://learn.microsoft.com/en-us/legal/windows-sdk/redist#microsoftwindowssdknetref) and retained `windows-sdk-LICENSE.rtf` |
| C#/WinRT runtime from that targeting pack | 2.2.0.48161 | WinRT.Runtime.dll; MIT, retained `cswinrt-LICENSE.txt` from its embedded source revision [8649ee3](https://github.com/microsoft/CsWinRT/blob/8649ee3eeb2445ca2a36d80d878ef60b96a6c65d/LICENSE) |

SQLite itself is [public domain](https://www.sqlite.org/copyright.html).
The Windows native library is supplied by SQLitePCLRaw; it is distinct from the
older Python validation runtime. Microsoft WebView2's complete incorporated notices
are retained without alteration. Building this host is not evidence of Store approval.
The Windows SDK targeting pack has its own explicit version pin; it is not a normal
PackageReference in packages.lock.json. Its package SHA-512 and packaged assembly
scope are recorded in the [composition research](docs/resreach/2026-10-04-windows-composition-and-input.md).
The SDK's original license was retrieved through the exact package's license URL,
`https://aka.ms/WinSDKLicenseURL`, on 2026-10-04. The full SDK, analyzers, Windows metadata
and tooling are not copied into the app output; only the required runtime projection
assemblies and retained licenses accompany the host.

## Android native host dependencies

AndroidX WebKit 1.16.0 and Credential Manager / Play Services bridge 1.5.0 are
AndroidX libraries under Apache-2.0. Gradle resolves unmodified artifacts from
Google's Maven repository; packaged META-INF notices must be retained.
Google Play Services Auth 22.0.0 and Google ID 1.1.1 are Google's SDK artifacts
subject to their packaged terms and Google APIs / Play Services SDK terms.
They are declared for this host, not copied from another application.
AGP 8.13.2 and Gradle 8.13 are external build tools, not shipped app runtimes.
Android SQLite, WebView, Keystore and framework APIs are supplied by the device.
No Android APK/AAB or completed dependency-license inventory is claimed until a
native build is produced.

## Validation version 0.1.0

No third-party pip/npm runtime packages, fonts, images, prior application code or assets
are bundled. QR generation uses Apple's system CoreImage API; no external QR library is copied.
The original implementation is covered by this repository's MIT license.

- Python 3.14.7 (minimum 3.12) is an external requirement, not bundled. Its
  [PSF license and incorporated software notices](https://docs.python.org/3/license.html)
  remain with the user's Python distribution.
- SQLite 3.51.0 is used through Python's standard library; it is
  [public domain](https://www.sqlite.org/copyright.html), not copied into the app.
- Swift 6.3.3 is a build tool. The app dynamically links the system Swift runtime;
  [Apache 2.0 and the Swift runtime exception](https://www.swift.org/LICENSE.txt) apply
  to Swift components. No Swift runtime libraries are bundled in this app.
- AppKit, Foundation, WebKit, CoreImage, CoreGraphics, CFNetwork and supporting Apple
  frameworks are dynamically loaded from macOS, under Apple's platform SDK/runtime terms.
  Framework binaries and SDK headers are not redistributed.
- Node 24.21.0 is used only for tests; it is not shipped. Its
  [license includes MIT and incorporated-component notices](https://github.com/nodejs/node/blob/v24.21.0/LICENSE).

The app Resources directory retains this notice and the root LICENSE. The exact tested
versions and scope are recorded in [runtime inventory](docs/validation/runtime-inventory.json).
This is an inventory of the delivered source and locally built Mac app; it is not an
approval or license audit for future store packages or unselected frameworks.

## Apple 1.0 native host dependencies

GoogleSignIn 9.2.0 is resolved as an unmodified Swift package from
[Google's repository](https://github.com/google/GoogleSignIn-iOS/tree/9.2.0), under its
[Apache-2.0 license](https://github.com/google/GoogleSignIn-iOS/blob/9.2.0/LICENSE).
Its resolved transitive packages remain subject to their individual licenses. The Xcode
build phase copies package root LICENSE/NOTICE/COPYING files before signing the bundle.
The final package inventory and merged SDK privacy manifests remain to be recorded from
an actual Apple archive; no native Apple 1.0 binary has been built in this session.
Apple SDK/runtime frameworks and system SQLite/CommonCrypto are linked from the platform.
App icons are generated from repository-owned drawing code, without external artwork.

## Linux native host runtime

The Linux source package uses distribution-provided Python, SQLite, GTK 3, WebKitGTK,
PyGObject/cairo, libsecret and cryptography. It does not redistribute those runtime
binaries. Their distribution packages retain upstream licenses and incorporated notices:
[GTK](https://www.gtk.org/), [WebKitGTK](https://webkitgtk.org/),
[PyGObject](https://pygobject.gnome.org/), [libsecret](https://gnome.pages.gitlab.gnome.org/libsecret/),
[cryptography](https://github.com/pyca/cryptography/blob/main/LICENSE).
Repository-owned Python code and generated paper icons are included with the root LICENSE.
An installed Linux runtime/package version inventory has not been produced on this Windows host.
