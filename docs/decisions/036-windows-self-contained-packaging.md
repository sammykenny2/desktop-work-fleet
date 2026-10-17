# ADR-036: Windows bundles the .NET Desktop runtime by default

## Status

Accepted, 2026-10-10. Supersedes the Windows framework-dependent packaging choice of ADR-028.

Revised 2026-10-16: the runtime version and target were updated to .NET 10.0.13 by [ADR-050](050-windows-wpf-display-loss-runtime.md).
The original decision background and the version used at the time are kept below; the current build and license sources are in
ADR-050, the deployment document and THIRD-PARTY-NOTICES.

## Context

The user wants other computers to install the downloaded MSIX without first installing the .NET 8 Desktop Runtime by hand.
This round explicitly authorized updating the documents and default scripts, committing and pushing, and then packaging with
the existing local certificate; it did not authorize a version bump or a GitHub release.

## Decision

- Windows MSIX and portable ZIP packages use `win-x64` and `--self-contained true` by default and include the complete
  publish output.
- `Build-WindowsApp.ps1 -SelfContained` uses the same RID and SelfContained settings for restore and build as for publish;
  app and core declare the win-x64 restore target and keep locked restore. Normal app, IDE and probe builds do not become
  self-contained.
- The self-contained runtime patch is pinned to 8.0.31 in the Core and WPF FrameworkReference metadata of the Windows app
  csproj; the global RuntimeFrameworkVersion is not used, so the Windows SDK targeting pack version is not overridden. The
  runtime patch is kept separate from the existing NuGet dependency versions and the product version.
  Changing the runtime patch requires checking the package sources and the complete licenses and notices, and rebuilding the app.
- The LICENSE and third-party notices of the Core runtime pack, and the nuspec files of both runtime packs, are copied, keeping
  the version and the source commit.
  The Desktop MIT license comes from `337963009d48a3016b50172b451b4e80f78791a7`, which the windowsdesktop package metadata
  points to; the WPF and WinForms incorporated notices come from their official v8.0.31 tags. They are placed in
  `src/native/licenses/` and kept in the package.
- No trimming, Native AOT or single-file; the existing WPF/WebView2 assets and the Release debugging protection stay in use.
- The package check requires the bundled .NET/WPF files, self-contained runtime metadata, a win-x64 deps target and the
  runtime notices. Tests with synthetic containers verify only the rejection conditions and do not claim that the stub DLLs in
  them can run; the final package is verified separately for its actual content and signature.
- WebView2 still uses the system Evergreen Runtime; MSIX trust, preview signing and the Windows 11 floor follow the existing
  contracts.
- The published windows-v0.1.2 keeps its original artifacts and the .NET prerequisite. The new local build is also 0.1.2; the
  existing tag and release are not changed.

## Consequences

### Positive

- Machines that receive the new package do not need a separate .NET Desktop Runtime installation.
- The RID, the restore and publish settings and the in-package runtime check agree, so a change to the packaging arguments
  alone cannot leave the runtime out.

### Negative

- The MSIX and ZIP downloads and their disk use grow.
- The bundled runtime does not receive system .NET updates; the app must be rebuilt, tested and released.

### Neutral

- Normal development builds still need the system .NET; the first package restore must download the runtime packs, and later
  runs with the same settings can use SkipRestore.
- This round does not install the product, change certificate trust or handle a same-version reinstall for the user.

## Alternatives Considered

### Keep framework-dependent

- A smaller package that can use system runtime updates; but it keeps the manual .NET installation step the user asked to
  remove, so it is not adopted.

### Ship a runtime installer with the package

- Still needs an extra installer and a system runtime; self-contained meets this round's need directly, so it is not adopted.

## References

- [ADR-028](028-native-package-and-signing-entry-points.md), [Deployment](../deployment.md), [Testing](../testing.md)
- [Microsoft .NET self-contained deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/#publish-as-self-contained)
- [Microsoft dotnet publish](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish)
- [Desktop MIT license](https://github.com/dotnet/windowsdesktop/blob/337963009d48a3016b50172b451b4e80f78791a7/LICENSE)
- [WPF notices](https://github.com/dotnet/wpf/blob/v8.0.31/THIRD-PARTY-NOTICES.TXT)
- [WinForms notices](https://github.com/dotnet/winforms/blob/v8.0.31/THIRD-PARTY-NOTICES.TXT)

*Decision made: 2026-10-10*
