# Windows native storage and WebView main window review

Date: 2026-10-04. Official capabilities, implementation choices and test evidence are kept apart; the decision is in
[ADR-015](../decisions/015-windows-native-storage-and-editor-host.md).

## Official capabilities and design inferences

- [Microsoft's WebView2 security guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)
  requires checking the origin, validating messages and avoiding generic proxies. This host uses an exact main
  document, fixed methods and JSON replies,
  and never treats scripts/file paths/tokens as parameters the renderer can specify.
- The [local content documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)
  describes virtual host mapping and secure-context DOM APIs; local assets load offline this way, without starting a
  listener.
- The [SQLite transaction documentation](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions)
  describes rollback and serializable behavior within one transaction; the local CAS, attachments and receipts are
  committed together.
- [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
  supports user protection and optional entropy. This implementation does not set LOCAL_MACHINE; the purpose/profile
  partition goes into the entropy.
  Inference: this prevents decrypting copied ciphertext directly under another profile, and does not amount to
  isolation from malicious programs within the same signed-in account.
- The [WebView2 package](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31) and
  [Microsoft.Data.Sqlite](https://www.nuget.org/packages/Microsoft.Data.Sqlite/10.0.12)
  were actually fetched; their versions and SHA-512 contentHash are pinned in the NuGet lockfile, and the full
  licenses are kept with the native output.

## Tests this time and their scope

The actual run results, fixes and the independent review are recorded in the git history; current status is in
[PROGRESS](../../PROGRESS.md).
The core probe uses real SQLite/Windows DPAPI; the Node probe uses a stdio test program connected to the real native
bridge, not a synthetic FileStore. The WPF probe loads the actual packaged page and saves and reopens through the real
DOM and WebMessage.
The UI probe window is off-screen and not activated, and injects no mouse input on the user's desktop; it cannot serve
as acceptance of pass-through/layering/mixed DPI.
A tool-restricted environment once caused a WebView2 browser process crash; the same probe passed when run as an
ordinary Windows user.
The WebView2 sandbox was not disabled, and the failure was not recorded as a success.

No code, assets or schema of another notes product were brought in; the above is platform API and package data.
