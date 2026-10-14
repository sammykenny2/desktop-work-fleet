# ADR-045: Windows 致命錯誤先離開 Explorer，再記錄、登入啟動重開一次

## Status

Accepted，2026-10-14。使用者回報 0.2.0 重開機後沒有自己啟動；查到它在登入時當掉並拖住 Explorer 後，使用者指示：
「他會引發 explorer 當掉的話，這專案也不用 go 下去了。三件事情你都做吧，我們再來抓問題。」
三件事是錯誤紀錄、登入啟動當掉時重開一次、本機 Windows Error Reporting 完整 dump。

## Context

- 2026-10-14 14:09 重開機。`WorkFleetStartup` StartupTask 為已啟用；14:11:29 Windows 以 StartupTask 啟動 0.2.0
  （Shell-Core 62408、AppModel-Runtime 201）。
- 14:12:13 程序結束：WPF render thread 先失敗，處理視窗訊息時 `HwndTarget.UpdateWindowSettings` 的 `SyncFlush`
  丟出 `UCEERR_RENDERTHREADFAILURE`（0x88980406）。例外在 user32 回呼內，所以是 fatal（接著 0xc000041d）。
- 桌面層與桌布層場景是 Explorer 桌面視窗的跨程序子視窗（ADR-030、ADR-035）。Windows Error Reporting 暫停程序寫報告時，
  Explorer 跟著卡住（AppHangXProcB1：P1 explorer.exe、P6 WorkFleet.exe），14:12:39 Explorer 被重新啟動。
- 同一台電腦手動開 0.2.0 跑了 150 秒都正常。Debug 模擬登入啟動（隱藏到系統匣，再加一張桌面便箋）跑了 65 秒也正常。
  當時沒有 dump，App 也沒有紀錄，所以 render thread 失敗的原因未知。
- App 沒有處理未處理例外，唯一證據在 Windows 事件記錄。

## Decision

### 先離開 Explorer

- Windows host 在 `Program.Main` 安裝 `CrashGuard`。UI 執行緒發生未處理例外時，先找出本程序裡父視窗屬於其他程序的所有視窗。
  只用 user32 處理：隱藏、把 `WS_CHILD` 換成 `WS_POPUP`、`SetParent(NULL)`。處理完再找一次，確認一個都沒剩。
- 拆離時 WPF 的視窗程序會在已失敗的 render thread 上再丟例外。這些巢狀例外只記錄（最多 20 筆）並標記為已處理。
- 確認全部離開後，才記錄並交給 Windows（`Environment.FailFast`，會產生 WER 報告；有設定 LocalDumps 時也會留 dump）。
  如果還有視窗留在 Explorer 裡，記錄後直接 `TerminateProcess`，不產生報告，避免 Explorer 在報告期間被卡住。
- 其他執行緒的未處理例外：在 UI 執行緒做同樣的拆離，限 2 秒內完成。UI 執行緒沒有回應、又仍有視窗在 Explorer 裡時，
  直接結束程序。

### 紀錄

- 寫在資料目錄的 `host.log`（MSIX 在套件的 `LocalCache\Local\WorkFleet`），每行帶本地時間與時區。
- 記錄的事件：
  - 每次啟動：版本、發行方式、PID、是否為登入啟動、是否為重開。
  - 交給已在執行的實例、啟動失敗、結束。
  - 致命錯誤：執行了多久、拆離數量、剩下數量，以及例外鏈每一層的 HRESULT 與完整文字。
  - 未觀察的 Task 例外。
  - 螢幕清單：啟動時、清單有變化時、開始套用新版面時，以及讀不到螢幕時。每台螢幕記下裝置名稱、是否為主螢幕、
    實體位置與大小、DPI；不記螢幕型號與工作區。用來對照螢幕變化和致命錯誤發生的時間。
- 不記錄便箋內容。檔案達 256 KiB 時轉存為 `host.log.1`。寫入失敗不影響 App。

### 登入啟動重開一次

- 只在四個條件都成立時重開：MSIX、登入啟動、這次不是重開出來的實例、錯誤鏈含 0x88980406。
  寫入 `restart.json`（PID、時間、原因）後，以 `explorer.exe shell:AppsFolder\<PFN>!WorkFleet` 啟動新實例，再交給 Windows。
- 新實例在認領資料目錄前先取走標記：先改名再讀，所以只有一個實例拿得到；超過 2 分鐘或時間在未來的標記直接丟棄。
- 新實例等舊程序結束，最多 60 秒，逾時就結束它；如果 PID 已被別的程序重用則不動。
- 新實例以登入啟動的方式隱藏開啟，而且不會再重開。重開失敗時刪除標記，避免下一次手動開啟被當成登入啟動。

### 驗證與本機診斷

- 只有 `app.workfleet.crashprobe.` 身分、且資料目錄有 `crash-probe.txt` 時，App 才把自己當成登入啟動。
  場景進入 Explorer 後，它在 dispatcher 丟出 0x88980406，供 `Test-WindowsRecovery.ps1` 使用。其他身分不讀這個檔。
- LocalDumps（`HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\WorkFleet.exe`）是本機診斷設定，
  App 與安裝程式都不寫它。設定方法見 [docs/testing.md](../testing.md)。

## Consequences

### Positive

- 當掉不再讓 Explorer 跟著卡住。MSIX 端到端測試中，4 個場景視窗在 Windows 寫 dump 前就離開 Explorer，
  Explorer 全程有回應，也沒有 hang 報告。
- 下次登入時再當掉，會留下 `host.log`，有設定 LocalDumps 時還有 dump。
- 登入啟動因 render thread 失敗時，使用者仍會得到一個隱藏在系統匣的 Work Fleet。

### Negative

- 只處理「當掉」。UI 執行緒長時間停住（同步 I/O、對話框、死結）時，跨程序子視窗仍可能拖住 Explorer。
  這是場景掛在 Explorer 的架構風險，需要另外評估。
- 重開使用 shell 啟動，依賴 Explorer 能回應；拆離之後 Explorer 應該可以回應。
- 0x88980406 的原因仍未知；重開只是保底，不是修正。
  - 0.2.1 登入當掉的 dump 顯示：Windows 先以合上的筆電內建螢幕當主螢幕，再把它關掉；App 套用新版面時發現 render thread 已失敗。
  - 用 DisplaySwitch 做同樣的切換（含 App 啟動後 6 到 14 秒）、在 App 啟動後合上上蓋，都沒有重現（`Test-WindowsDisplaySwitch.ps1`）。
- 完整 dump 約 1 GB（0.2.0 測試身分實測 1016 MB）。

### Neutral

- 手動啟動時發生 render thread 失敗不重開，只記錄並交給 Windows。

## Alternatives Considered

### Alternative 1: 直接 TerminateProcess，不經 WER

- **Pros**: Explorer 最快恢復。
- **Cons**: 沒有 dump，查不到原因。
- **Why rejected**: 先拆離就能兩者兼得；只有拆離失敗時才這樣做。

### Alternative 2: RegisterApplicationRestart

- **Pros**: 由 Windows 負責重開。
- **Cons**: 程序要執行滿 60 秒才會重開（這次只跑了 44 秒）；不能要求隱藏，也不會等舊程序結束。
- **Why rejected**: 不適用於登入當下的失敗。

### Alternative 3: 改用軟體繪圖（RenderMode.SoftwareOnly）

- **Pros**: 可能避開 GPU 相關的 render thread 失敗。
- **Cons**: 原因未明；4K 全螢幕場景的效能會變差。
- **Why rejected**: 先收集證據再決定。

### Alternative 4: 標記例外已處理後繼續執行

- **Pros**: 不必重開。
- **Cons**: render thread 失敗後，同一個程序無法再繪圖。
- **Why rejected**: 無法恢復。

## References

- [ADR-030](030-windows-explorer-wallpaper-layer.md)、[ADR-035](035-windows-attached-scene-background-lifecycle.md)：場景掛在 Explorer
- [ADR-043](043-desktop-window-placement-and-startup-behavior.md)：登入啟動與隱藏啟動
- [docs/testing.md](../testing.md)：`--crash-guard` probe、`Test-WindowsRecovery.ps1`、`Test-WindowsDisplaySwitch.ps1`、LocalDumps

---

*Decision made: 2026-10-14*
*Decision makers: 使用者、Claude*
