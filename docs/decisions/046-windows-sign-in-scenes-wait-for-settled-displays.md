# ADR-046: Windows 登入啟動等螢幕穩定後才把場景掛進 Explorer

## Status

Accepted，2026-10-14。使用者看過兩次登入當掉的 `host.log` 後指示：「先做登入時等螢幕穩定再掛場景的修正」。

2026-10-15 修訂：
- 0.2.5 登入啟動時，等待沒有生效，場景 2.8 秒就掛進 Explorer。啟動時兩台螢幕都在，內建螢幕是主螢幕。
- 約 100 秒後 Windows 關掉內建螢幕；再 30 秒，外接螢幕改編號，程式隨即當掉（[ADR-049](049-windows-attached-scenes-render-in-software.md)）。
- 當時的 `host.log` 看不出等待為何放行。依程式，有三種情況都會立刻放行：
  - `lid=open`：Windows 回報上蓋是開的。推論（未驗證）：開機時 Windows 自己也以為上蓋開著，所以才點亮內建螢幕。
  - `lid=unreported`：判斷時還沒收到第一次上蓋回報，視同打開。判斷只做一次，之後才到的 `lid closed` 不會讓場景重新等待；
    `lid closed` 出現在 `scenes attaching` 之後，就是這種情況。
  - `builtIn=unread other=unread`：讀不到螢幕設定，視同不必等。
- 因此 `host.log` 補上判斷依據，下次就分得出是哪一種：
  - 每次 Windows 回報上蓋狀態都記一行 `lid closed` 或 `lid open`，包括註冊當下回報的那一次。
  - `scenes waiting` 與 `scenes attaching after` 兩行後面加上判斷輸入，例如 `; lid=open builtIn=on other=on changed=none`。
- 等待本身只能避開第一次變動，判斷規則不變。後續的修正方向見 ADR-049。

## Context

- 這台筆電平常合著上蓋、只用外接 4K。開機後要先開蓋再合蓋，外接螢幕才有畫面，然後才登入。
- 0.2.1（21:12 開機）與 0.2.2（23:00 開機）兩次登入都當掉（ADR-045）。0.2.2 的 `host.log`：
  - 登入後約 60 秒，Windows 以 StartupTask 啟動 Work Fleet。
  - Work Fleet 讀到兩台螢幕：合著的內建螢幕（1920×1080、125%）是主螢幕，外接 4K（150%）在右側。
  - 登入後約 75 秒，Windows 才關掉內建螢幕，只剩外接 4K。Work Fleet 開始套用新版面，約 1 秒後 render thread 失敗。
- 0.2.1 那次的 dump 也是同樣的螢幕變化。兩次切換都在登入後約 75 秒，跟 Windows 處理 Work Fleet 自啟動花了多久無關。
- 登入後用 DisplaySwitch 做同樣的切換、在 App 啟動後合上上蓋，都沒有重現（`Test-WindowsDisplaySwitch.ps1`）。
  上蓋合著時 Windows 不讓 DisplaySwitch 延伸到內建螢幕，「上蓋合著、內建螢幕卻仍啟用」只在開機登入時出現。
- 使用者看到的登入後縮放不對，就是內建螢幕還是主螢幕的那段時間。

## Decision

- 只限登入啟動：場景（桌面層、桌布層、浮動層）先不建立視窗、不掛進 Explorer，等螢幕穩定才開始。主畫面與資料照常啟動。
- 判斷規則（core `SignInDisplays`）：
  - 上蓋合著、內建螢幕仍開著、另外還有其他螢幕時，等。內建螢幕指 internal、LVDS、embedded DisplayPort、UDI embedded 連接方式的螢幕。
  - 螢幕清單剛變過時，等它 5 秒沒有再變。
  - 從主畫面載入起最多等 3 分鐘，之後照常掛上場景，並記錄原因。
  - 沒有上蓋狀態（桌機）視為打開；合著但只有內建螢幕時不等，因為 Windows 不會關掉它。
- 上蓋狀態：顯示器監看視窗註冊 `GUID_LIDSWITCH_STATE_CHANGE`，Windows 在註冊當下就回報目前狀態，之後每次變化都通知；
  上蓋變化與每秒一次的檢查都會重新判斷。連接方式由 `QueryDisplayConfig` 的作用中目標讀取。
- `host.log` 記錄 `scenes waiting: <原因>`（原因改變時）與 `scenes attaching after <秒>s`；到達上限時多記 `although <原因>`。
  2026-10-15 起兩行都附上判斷輸入，另外記錄每次上蓋回報（見 Status 的修訂）。

## Consequences

### Positive

- 登入時內建螢幕被關掉的那一刻，Explorer 裡沒有 Work Fleet 的場景視窗。
- 下次登入的 `host.log` 會顯示場景等了多久、為什麼等。
- 平常開機（螢幕已穩定）只多一次判斷；這台機器的測試身分記錄為 0.6 秒。

### Negative

- 等待期間桌面上看不到便箋，最多 3 分鐘；資料、主畫面與系統匣不受影響。
- 主畫面在登入啟動時仍以看不到的位置顯示，WPF 仍有一個繪圖目標。
  如果之後在場景等待期間仍出現 render thread 失敗，代表原因不在場景掛在 Explorer 上；`host.log` 會顯示「scenes waiting」後接「fatal」。
- 只處理筆電合蓋這一種「螢幕尚未穩定」。其他登入時才發生的螢幕變化只受 5 秒靜止與 3 分鐘上限保護。
- render thread 失敗的原因仍未知。

### Neutral

- 手動啟動不等待。
- 等待只延後 `Start()`；網頁端照常呼叫 `desktop.start`，場景晚一點準備好時再取得版面。

## Alternatives Considered

### Alternative 1: 登入後固定延遲

- **Pros**: 簡單，不需要讀上蓋與連接方式。
- **Cons**: 75 秒是這台機器的值，其他機器不同；每次登入都要等。
- **Why rejected**: 上蓋與內建螢幕的狀態能直接判斷，不必猜時間。

### Alternative 2: 只等螢幕清單一段時間沒有變化

- **Pros**: 不依賴上蓋狀態。
- **Cons**: 0.2.2 那次 Work Fleet 啟動時，螢幕清單已經一分鐘沒變，14 秒後 Windows 才關掉內建螢幕。
- **Why rejected**: 預測不到這次切換；只保留作為切換後的 5 秒靜止。

### Alternative 3: 場景改用軟體繪圖（ADR-045 替代方案 3）

- **Pros**: 可能避開 GPU 相關的 render thread 失敗。
- **Cons**: 原因未知，不保證有效；4K 全螢幕場景效能變差；只能靠重開機驗證。
- **Why rejected**: 先避開已知會出事的時間點；如果等待期間仍當掉，再評估這個方案。
  2026-10-15 改為只讓掛在 Explorer 的場景用軟體繪圖，見 ADR-049。

## References

- [ADR-045](045-windows-fatal-error-leaves-explorer-first.md)：當掉時先離開 Explorer、`host.log`
- [ADR-043](043-desktop-window-placement-and-startup-behavior.md)：登入啟動與隱藏啟動
- [docs/testing.md](../testing.md)：core probe、`--platform`、`--sign-in-hold`、`Test-WindowsDisplaySwitch.ps1`

---

*Decision made: 2026-10-14*
*Decision makers: 使用者、Claude*
