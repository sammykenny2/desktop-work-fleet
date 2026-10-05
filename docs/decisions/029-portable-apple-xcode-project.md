# ADR-029: 可攜且可直接開啟的 Apple Xcode 專案

## Status

Accepted，2026-10-05。使用者要求 Mac clone 後可直接用 Xcode 開啟。

## Context

原有生成器將 Xcode 專案寫入 Git 忽略的 build/apple，並使用生成機器的絕對 source 路徑。
這讓 Mac clone 後沒有可直接開啟的專案，也不能搬用 Windows 的生成檔。
Android 已有提交的 IDE 專案；兩者應有一致的 checkout 交付方式。

## Decision

- `src/native/apple/WorkFleet.xcodeproj`、workspace、iOS／macOS shared schemes、圖示與預設 xcconfig 納入 Git。
  source、資源與 entitlements 使用 SOURCE_ROOT／SRCROOT 的相對路徑，專案不包含機器路徑或 `.env` 值。
- Xcode 開啟不需 Node 先生成專案；Run／Build 的 Prepare local resources phase 自動執行 npm lockfile
  安裝及 web assets／公開配置／Info.plist 生成。各 target 的輸出位於忽略的 `.generated/<target>/`，
  phase 宣告輸出，讓資源複製與 Info.plist 處理依賴其生成；每次準備以納入 `.env`／來源變更。
- Share Extension 只產生其 Info.plist，不安裝 npm、不打包主 App 的配置／Google 識別或工作區資料。
  主 App 仍嵌入 Extension，原生資料／分享契約沿用 ADR-023／ADR-027。
- IDE 的 app ID／App Group／Team 由預設 xcconfig 與忽略的 Local.xcconfig 控制；
  公開 Google／商店欄位讀取 `.env`。生成配置採用有效 Xcode identity，避免與簽章不一致。
  CLI wrapper 使用同一份專案，可由 `.env` 的非空 identity 覆蓋；不重寫使用者的 IDE 專案。
- Xcode user-script sandboxing 關閉，供 Node/npm bootstrap、讀取本機配置與外部工具路徑使用。
  此設定只涉及建置工具，App Sandbox／Keychain／entitlements 保留。
- 結構生成器僅供維護已提交的專案；DerivedData、archives、exports 與 npm cache 保留於 build/apple。

## Consequences

### Positive

Mac clone 後可直接開啟專案；checkout 搬移無須修補 source 路徑，簽章與本機配置不進 Git。

### Negative

建置需 Node 22+／npm，首次需下載 npm／SPM 依賴；新增 Swift source 時需維護專案參照。
本機沒有 Apple SDK，可攜性與資產檢查不代表 Xcode 編譯、裝置或簽章驗收。

## Alternatives Considered

沿用忽略的生成專案：不符合 clone 後直接開啟的明確要求。
提交 Windows 生成的絕對路徑專案：不能在另一台 Mac 使用，且會帶入機器配置。

## References

- [Apple 專案說明](../../src/native/apple/README.md)、[執行狀態](../../PROGRESS.md)。
- [Apple Run Script phases 與輸入／輸出依賴](https://developer.apple.com/documentation/xcode/running-custom-scripts-during-a-build)。
- [Apple build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference)。

*Decision made: 2026-10-05*
