# SPEC-005: Windows 11 新舊桌面相容性

## Metadata

| Field | Value |
|---|---|
| Status | Approved（實作與驗收證據只在 PROGRESS 維護） |
| Owner | 專案維護者 |
| Reviewer | 使用者已確認支援範圍；技術獨立審閱尚未安排 |
| 日期 | 2026-10-09 |
| Related Plan | [PLAN-004](../plans/004-windows-11-compatibility.md) |

## Summary

讓同一 Windows App 可使用 Windows 11 23H2 與更早版本，也保留 24H2+ 的功能；
以實際 Explorer 結構與能力處理桌面，不因 package 最低版本排除早期 Windows 11。
Windows 10 不需適配，但未來 Store 必須拒絕它安裝。執行狀態只在 PROGRESS。

## Goals

- 在使用者提供的 23H2 實測桌面、桌布、最上層、群組／全部操作與退出恢復。
- 保留新版 Explorer 路徑與既有 renderer／保存行為；以適當回歸減少 regression。
- 將 MSIX 安裝下限改為 Windows 11 基線，驗證最終包的實際 manifest。
- 清楚區分目標支援、原生實測、模型測試、preview 安裝與 Store 提交。

## Non-Goals

- Windows 10 產品功能適配或完整測試矩陣。
- 本批保留 Partner Center 名稱、申請帳號／憑證、送 Store 或發布預覽 release。
- 更換 WPF／WebView2、移植其他產品，或改變同步／備份／資料格式及非 Windows 行為。

## Requirements

### Functional Requirements

| ID | 要求 |
|---|---|
| W11-F01 | Windows 11 21H2／22H2／23H2 與 24H2+ 是支援目標；不得只為排除 Windows 10 而把最低版本抬到 24H2 |
| W11-F02 | 依實際 Explorer 拓撲發現真正圖示宿主，以及其後的 sibling 或其內圖示下方的 child WorkerW；同 PID／疊序／有效性限制繼續成立 |
| W11-F03 | 三種常駐圖層與指定群組／All 暫時浮動遵守 SPEC-003；退出依目前群組設定還原，位置、尺寸與偏好不被相容性處理改寫 |
| W11-F04 | 圖示上下關係、空白桌面穿透、紙面輸入／唯讀選字與 wallpaper 穿透遵守現有政策；不得照搬另一產品的預設 |
| W11-F05 | 保留 windowed WebView2 附著顯示、Start 的可见建立／空 region 順序、3 邏輯像素紙面圓角、floating composition 與不搶焦點行為 |
| W11-F06 | 附著後核對真正 parent／WS_CHILD／非 topmost、physical bounds 與 DPI；失效不得冒充成功，不能任選 WorkerW 作 wallpaper |
| W11-F07 | Explorer 重建、顯示器變更與喚醒按 ADR-020／030 恢復；健康狀態不定時反覆重掛，保留草稿保存屏障與單一 Workspace |
| W11-F08 | MSIX TargetDeviceFamily 為 Windows.Desktop，MinVersion 目標為 10.0.22000.0；保持目前 26200 的 MaxVersionTested，最終產物驗證與來源一致 |
| W11-F09 | Windows 10 應被 MSIX 版本適用性排除；上架前另驗證 Store 的取得／安裝入口，不以啟動時報錯替代 |
| W11-F10 | 支援與證據分開：另一專案的 Rust／Svelte／原生測試結果、純拓撲測試或 WebView 離屏截圖都不代替本專案實機顯示／輸入 |

### Non-Functional Requirements

- 保持資料交易、草稿、Google、附件及備份；正常資料測試前備份並關閉既有實例，Debug 與安裝版共用資料目錄。
- 測試探針使用合成資料；不要自動重啟 Explorer、改桌布／registry、安裝憑證或移除 App。
- 沒有新版設備時，保留既有基線、補舊新拓撲及 failure/recovery 回歸，逐項揭露未測範圍。

## Acceptance

| 案例 | 必要證據 |
|---|---|
| W11-C01 安裝資格 | 最終 MSIX 的 Windows.Desktop／22000 下限斷言；23H2 實際安裝與啟動；Windows 10 拒絕安裝在可取得設備時補驗 |
| W11-C02 新舊宿主 | classic sibling 與 Progman child、錯誤 PID／圖示宿主／無宿主的判定回歸；23H2 真 Explorer 的 parent 與疊序 |
| W11-C03 開機初次呈現 | 直接啟動即正常畫出桌面／桌布便箋，不需先切層；真螢幕像素與黑塊／角落目檢 |
| W11-C04 操作與輸入 | 群組／All→floating→退出、選卡／拖動／編輯／唯讀選字、空白與 wallpaper 穿透；桌面圖示仍能操作 |
| W11-C05 座標與區域 | 反覆切層不漂移、不變尺寸；resize／DPI 後區域與實際紙面對齊；混合 DPI 需真多顯示器 |
| W11-C06 系統生命週期 | 使用者配合的 Win+D、Explorer 重啟、休眠／喚醒與顯示器變更；內容／草稿保護，重新發現宿主 |
| W11-C07 新版保護 | 既有 native probes 與共用行為回歸；24H2／25H2+ 實機由具備設備者補驗；缺設備不得標通過 |
| W11-C08 Store | 上架階段確認正式 identity、Windows 10 取得／安裝拒絕及支援文案；本批保持未開始 |

下表保留開始前基線；同日後續原生與包內容結果見 PROGRESS。

| 版本 | 支援目標 | 本批開始前證據（歷史） |
|---|---|---|
| 21H2／22000、22H2／22621 | 是 | 本輪沒有設備，未測 |
| 23H2／22631 | 是；優先實測 | 本機 22631.6199、144 DPI 唯讀宿主盤點；尚未跑本專案原生探針 |
| 24H2／26100 | 是 | 沒有本輪設備／實測 |
| 25H2／26200 及以後 | 是 | PROGRESS 有 26200 歷史原生證據；本批改動後未實機回歸，更新版本亦未測 |
| Windows 10 | 否 | 未來 MSIX／Store 安裝拒絕；不驗收產品功能 |

## Dependencies and Open Questions

依賴 ADR-028／030 的現有封裝與場景、.NET 8／Evergreen WebView2，以及可用的 Windows 桌面 session。
使用者已確定支援範圍，無需重問是否要 23H2 或 Windows 10 功能適配。
尚待外部條件為新版設備／完整顯示器矩陣與後續 Partner Center 身份；它們不阻止先完成 23H2 工作。

## References

- [ADR-034](../decisions/034-windows-11-compatibility-and-install-floor.md)、[PLAN-004](../plans/004-windows-11-compatibility.md)、[接手](../handoff/2026-10-09-windows-11-compatibility-handoff.md)
- [SPEC-003](003-desktop-cards-groups-and-formation.md)、[測試](../testing.md)、[PROGRESS](../../PROGRESS.md)

*Created: 2026-10-09*
