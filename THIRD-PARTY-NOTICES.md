# Third-party notices

Updated: 2026-10-10.

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
| esbuild / platform binary | 0.28.2 | Apple script bundling at build time, tool not bundled | MIT; [esbuild](https://github.com/evanw/esbuild/blob/v0.28.2/LICENSE.md) |

Marked copyright: (c) 2018+, MarkedJS; (c) 2011–2018, Christopher Jeffrey.
DOMPurify copyright: Cure53 and other contributors. The source ESM files are copied
without modification. fflate copyright: (c) 2026 Arjun Barrett; its browser ESM is copied
without modification; application configuration is separate. The build includes
`marked-LICENSE.txt`, `dompurify-LICENSE.txt`, `fflate-LICENSE.txt` and this notice. Platform packages must
retain those files and the project's LICENSE. Final native SDK and store-package
inventories remain separate release work.

Apple packages also combine the renderer and scene modules into classic deferred
scripts using esbuild. Upstream legal comments remain in those generated scripts;
the complete three runtime LICENSE files and unmodified vendor modules are retained.
Source modules, other platforms and the default web build keep the ESM format.

## Windows native host under development

NuGet `packages.lock.json` files pin versions and SHA-512 package content hashes.
The native output retains complete upstream license/notice files from `src/native/licenses`.
Default MSIX/ZIP packaging bundles the self-contained .NET 8 Desktop runtime (8.0.31).
The package retains the Core runtime pack's LICENSE.TXT, THIRD-PARTY-NOTICES.TXT and
the Core/Desktop runtime pack nuspec files in `Licenses/dotnet/`, including resolved
versions, copyright and upstream repository commits. The Desktop MIT license and
WPF/WinForms incorporated notices are retained in `src/native/licenses/dotnet-*`:
Desktop license from [the runtime pack's windowsdesktop commit](https://github.com/dotnet/windowsdesktop/blob/337963009d48a3016b50172b451b4e80f78791a7/LICENSE),
[WPF v8.0.31 notices](https://github.com/dotnet/wpf/blob/v8.0.31/THIRD-PARTY-NOTICES.TXT) and
[WinForms v8.0.31 notices](https://github.com/dotnet/winforms/blob/v8.0.31/THIRD-PARTY-NOTICES.TXT).
Ordinary development builds remain framework-dependent. Evergreen WebView2 and
the .NET SDK are not bundled. Runtime patch changes require updating this provenance
and the retained Desktop notices; see [ADR-036](docs/decisions/036-windows-self-contained-packaging.md).

| Package | Version | Scope / license |
|---|---|---|
| Microsoft.Web.WebView2 | 1.0.4258.31 | WPF/Core managed assemblies and WebView2Loader; Microsoft SDK license, complete LICENSE and NOTICE from this exact NuGet package |
| Microsoft.NETCore.App.Runtime.win-x64 / Microsoft.WindowsDesktop.App.Runtime.win-x64 | 8.0.31 | Bundled .NET/Core/WPF runtime; MIT and incorporated notices retained as described above |
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
The checked-in Android Gradle Wrapper (scripts and JAR) was generated by the
official Gradle 8.13 binary distribution, verified against SHA-256
`20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78` from
[Gradle's release checksums](https://gradle.org/release-checksums/).
The generated wrapper JAR SHA-256 is
`81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f`.
Gradle's Apache-2.0 license and incorporated-component notices are retained in
`src/native/android/gradle/LICENSE.txt` and `src/native/android/gradle/NOTICE.txt`.
Wrapper distribution downloads require the pinned SHA-256 in
`gradle/wrapper/gradle-wrapper.properties`; the wrapper is not bundled into the APK.
Android SQLite, WebView, Keystore and framework APIs are supplied by the device.
The Android asset build retains this notice and the root LICENSE. The current
APK/AAB build status is recorded in PROGRESS.md; a debug APK does not establish
the final store package's complete resolved dependency-license inventory.
Each Android variant bundles `assets/licenses/native/inventory.json`, resolved
runtime artifact hashes, upstream Maven POMs and embedded LICENSE/NOTICE/COPYING
files (including those in AAR classes/libraries). Missing POM license declarations
remain explicitly marked. The full [Apache-2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt)
is retained at `src/native/licenses/apache-2.0-LICENSE.txt` and accompanies AndroidX.
This collected upstream metadata does not replace the final release's SDK terms.
Pinned SDK command-line tools and Gradle can be installed under build/toolchain;
their SHA-256 checksums come from the official [Android download](https://developer.android.com/studio#command-line-tools-only)
and [Gradle checksum](https://gradle.org/release-checksums/) pages.
These downloaded development tools are not included in the APK.

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
an actual Apple archive; macOS 0.1.0 Debug universal has been built and development
signed, while the formal archive and complete release inventory remain pending.
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
Optional desktop integration loads distribution-provided GtkLayerShell, Keybinder 3,
Ayatana/AppIndicator and the XDG desktop portal service. These components are not bundled;
their installed distribution packages supply their licenses and notices.
An installed Linux runtime/package version inventory has not been produced on this Windows host.
