# ADR-033: Apple 本機封裝腳本

## Status

Accepted（Apple 資產封裝修正），2026-10-05。
更新 ADR-009／ADR-029 的 Apple 輸出格式，不改來源模組或資料契約。

## Context

在有效 Apple Development 簽章與 profile 下，真 Keychain／SQLite 已通過，
WKWebView 能載入本機 HTML，但 `type="module"` 主腳本載入失敗，主畫面停在正在載入。
獨立 fixture 的 resource error 指向封裝的 `app/main.js`，bridge 尚未建立。
證據與限制見 [研究紀錄](../resreach/2026-10-05-apple-signed-startup-and-local-scripts.md)。

## Decision

- Apple Prepare local resources 使用 lockfile 固定的 esbuild 0.28.2，
  將共用主畫面／桌面場景各自合併成 browser IIFE，目標 Safari 16。
- Apple HTML 使用本機 classic deferred script，移除已不需使用的 import map 與其 CSP hash。
  CSP 仍只允許 self script；本機檔案 read-access 範圍、主 frame／document bridge 檢查保持不變。
- 來源、其他平台及預設 web build 保留 ESM；沒有 runtime server 或新的 listener。
- 保留依賴 legal comments、原始 vendor 與完整 LICENSE，esbuild 只作建置工具。
- 使用唯一 bundle identity 的開發簽章 fixture，實際驗證 Keychain、SQLite 與隨包主畫面。
  測試不存取使用者便箋，完成後清除自己建立的 Keychain 項目。

## Consequences

### Positive

本機 WKWebView 可以完成 native 初始化；macOS／iOS 共用同一 Apple 封裝方式與來源。

### Negative

Apple 建置新增固定版本的開發工具與生成腳本；完整 iOS、Intel 與桌面操作仍需實機驗收。

### Neutral

有效簽章／profile 仍是 Data Protection Keychain 的前置條件；合併腳本不能替代簽章或公證。

## Alternatives Considered

沿用原樣 ESM：本機簽章 fixture 已重現無法啟動。
放寬私有 WebKit file/CORS 設定：不符合既有公開 API 與限定資產邊界。
新增 HTTP listener：只是資產封裝問題，沒有加入常駐服務的必要。

## References

- [ADR-009](009-local-renderer-and-persistence.md)、[ADR-023](023-apple-native-host-and-scenes.md)、[ADR-029](029-portable-apple-xcode-project.md)。
- [esbuild bundling API](https://esbuild.github.io/api/#bundle)。
- [Apple 本機資產載入](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:))。

*Decision made: 2026-10-05*
