# ADR-036: Windows 預設自帶 .NET Desktop runtime

## Status

Accepted，2026-10-10。取代 ADR-028 的 Windows framework-dependent 封裝選擇。

2026-10-16 修訂：runtime 版本與 target 由 [ADR-050](050-windows-wpf-display-loss-runtime.md) 更新為 .NET 10.0.13。
以下保留原決策背景與當時版本；目前建置與授權來源見 ADR-050、部署文件及 THIRD-PARTY-NOTICES。

## Context

使用者希望其他電腦下載 MSIX 後，不用先手動安裝 .NET 8 Desktop Runtime。
本輪明確授權更新文件與預設腳本、commit／push，再使用既有本機憑證打包；不升版或觸發 GitHub release。

## Decision

- Windows MSIX／portable ZIP 預設使用 `win-x64`、`--self-contained true`，完整封入 publish 產物。
- `Build-WindowsApp.ps1 -SelfContained` 在 restore／build 使用與 publish 相同的 RID／SelfContained 設定；
  app／core 宣告 win-x64 restore target 並保留 locked restore。一般 App／IDE／probe 建置不改成 self-contained。
- self-contained runtime patch 固定為 8.0.31，記在 Windows app csproj 的 Core／WPF FrameworkReference metadata；
  不用全域 RuntimeFrameworkVersion，以免覆蓋 Windows SDK targeting pack 版本。與現有 NuGet 依賴版號及產品版號分開。
  更換 runtime patch 時同步檢查套件來源、完整授權／notices 並重建 App。
- 複製 Core runtime pack 的 LICENSE／第三方 notices，以及兩個 runtime pack 的 nuspec，保留版本與來源 commit。
  Desktop MIT 授權取自 windowsdesktop package metadata 指向的 `337963009d48a3016b50172b451b4e80f78791a7`，
  WPF／WinForms incorporated notices 取自各自官方 v8.0.31 tag，放在 `src/native/licenses/` 並隨包保留。
- 不啟用 trimming、Native AOT 或 single-file；現有 WPF／WebView2 資產與 Release debugging 防護繼續使用。
- 包檢查要求 bundled .NET／WPF files、self-contained runtime metadata、win-x64 deps target 與 runtime notices。
  測試合成容器只驗證拒絕條件，不宣稱其中的 stub DLL 可執行；最終包另驗證實際內容與簽章。
- WebView2 仍使用系統 Evergreen Runtime；MSIX 信任／preview 簽章及 Windows 11 下限沿用既有契約。
- 已發布的 windows-v0.1.2 保留原產物與 .NET 前置需求。本機新版同為 0.1.2；不改既有 tag／release。

## Consequences

### Positive

- 新封裝接收端不用另外安裝 .NET Desktop Runtime。
- RID、restore／publish 設定與包內 runtime 檢查一致，避免只有打包參數變更而漏掉 runtime。

### Negative

- MSIX／ZIP 的下載與磁碟占用增加。
- 內附 runtime 不使用系統 .NET 的更新；需重新建置、測試並發布 App。

### Neutral

- 一般開發建置仍需系統 .NET；第一次 package restore 需取得 runtime packs，後續相同設定可 SkipRestore。
- 本輪不安裝產品、修改憑證信任或替使用者處理同版號重新安裝。

## Alternatives Considered

### 保留 framework-dependent

- 包較小，可使用系統 runtime 更新；但保留使用者要求移除的手動 .NET 安裝步驟，因此不採用。

### 隨包附 runtime 安裝器

- 仍需額外安裝程序與系統 runtime；self-contained 能直接滿足這輪需求，因此不採用。

## References

- [ADR-028](028-native-package-and-signing-entry-points.md)、[部署](../deployment.md)、[測試](../testing.md)
- [Microsoft .NET self-contained deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/#publish-as-self-contained)
- [Microsoft dotnet publish](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish)
- [Desktop MIT license](https://github.com/dotnet/windowsdesktop/blob/337963009d48a3016b50172b451b4e80f78791a7/LICENSE)
- [WPF notices](https://github.com/dotnet/wpf/blob/v8.0.31/THIRD-PARTY-NOTICES.TXT)
- [WinForms notices](https://github.com/dotnet/winforms/blob/v8.0.31/THIRD-PARTY-NOTICES.TXT)

*Decision made: 2026-10-10*
