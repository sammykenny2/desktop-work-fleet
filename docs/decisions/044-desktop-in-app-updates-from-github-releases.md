# ADR-044: 從公開 GitHub Releases 的桌面 App 內更新

## Status

Accepted，2026-10-14。使用者確認：維護者會把 repo 改為 public；Windows、macOS、Linux 都要 App 內升級，
Windows 使用 MSIX；同日指示開工。macOS 安裝方式（SPEC-006 Q02）與其他 Q 仍待回答。參考與證據見 [研究](../resreach/2026-10-14-desktop-window-startup-and-update-reference.md)。

2026-10-15 修訂：使用者回報 Work Fleet 查更新受限、同機的公開 release feed 可成功，要求修改 ADR 與程式。
三平台移除未驗證 GitHub REST API 查詢，改用公開 Atom feed。共用 NAT 出口的 API 配額不能作為桌面更新的前提；
官方規則與實測見 [更新查詢限流研究](../resreach/2026-10-15-public-release-feed-without-api-quota.md)。

## Context

App 沒有版本顯示，也沒有更新檢查；使用者要自己到 GitHub 下載 MSIX，同版號還要先解除安裝。
`host.info` 不含版本，備份 `appVersion` 固定記成 0.1.0。各平台版號獨立（ADR-028），
只有 Windows 以 `windows-v<版號>` prerelease 發布 MSIX、`.sha256` 與 CER；macOS、Linux 目前只有本機建置。

Renderer 被 CSP 與原生政策封閉，不能連外；原生 HTTP 只允許固定 Google 端點並拒絕轉址。
GitHub 會成為新的網路目的地，隱私說明需要更新。參考專案的 electron-updater、`latest.yml`、NSIS 與 Squirrel.Mac
都不能用在 WPF／AppKit／GTK；它的狀態機、能力閘門與失敗經驗可以沿用。
GitHub 的 `releases/latest` 是整個 repo 的最新版，無法區分平台，且排除 prerelease。
公開 `releases.atom` 可包含各平台已發布的預覽 tag，由 host 以 tag 前綴與數值版號挑選，不需要 REST API。

## Decision

### 狀態與介面

- 每個原生 host 擁有自己的更新器，遵守相同狀態與 bridge 契約：
  unavailable、idle、checking、up_to_date、update_available、downloading、downloaded、installing、failed；
  快照含目前版本、可用版本、純文字摘要（最多 500 字）、上次檢查時間、下載進度、錯誤碼與 nextAction。
- 同時只執行一個檢查或下載，重複要求加入進行中的工作。下載前重新檢查；已下載版本仍是最新才保留，否則重新下載。
  只持久化 lastCheckedAt（`host-preferences.json`，ADR-043），其他狀態每次啟動回到 idle。
- 錯誤使用穩定代碼與繁中文案（offline、timeout、rate_limited、provider_rejected、metadata_invalid、checksum_mismatch、
  signature_rejected、identity_mismatch、authorization_cancelled、install_failed、unknown）；原始回應不進 UI。
- 設定＞桌面「App 更新」顯示版本、頻道（預覽）、狀態、摘要、上次檢查與依 nextAction 的單一主按鈕：
  檢查更新、下載更新、重新啟動並安裝。沒有更新能力時只顯示版本與原因。
- Windows、macOS、Linux 系統匣在有更新能力時新增「檢查更新…」。由原生直接處理，不經 `desktop-action`。
  點擊一律重新檢查，再以原生對話框回答：已是最新、有新版（版本、摘要，「更新並重新啟動」／「稍後」）或錯誤。
  macOS 對話框先啟用 App，避免開在其他視窗後方。下載進度顯示在系統匣提示文字。
- 本批不做自動檢查、定期檢查或略過版本；是否加入列為 SPEC-006 的 Q。

### 能力閘門

- 更新來源放在每個平台都會帶的 `Config/public.json` 的 `update` 區段：`repository`（`owner/repo`，
  `WORK_FLEET_UPDATE_REPOSITORY`，預設本 repo）與 `channel`（目前只有 `preview`）。無效時只顯示版本。
- 只有可就地升級的安裝形式有更新能力：Windows MSIX、已用 Developer ID 簽章並公證的 macOS App、以 DEB 安裝的 Linux。
  Windows ZIP／Debug、未簽章 macOS、tar.gz 與原始碼執行只顯示版本與 Releases 頁面連結。
- 本機以相同 identity 封裝的預覽包也可檢查與更新；設定頁標示來源。
- 測試來源：只有套件身分以 `app.workfleet.updateprobe.` 開頭時，資料目錄的 `update-probe.txt` 可指定本機資料夾取代 GitHub，
  並在啟動後自動下載安裝。Release 程式包含這段判斷，但正式身分一律忽略。不用 Debug 組態，因為安裝必須是已簽章的 MSIX。

### Feed 與下載

- 查詢 `https://github.com/<repository>/releases.atom`，不帶憑證或 cookie，不回退到 REST API；查詢拒絕轉址。
  Atom 只列已發布 release（不含 draft），預覽頻道包含 prerelease。只讀 Atom namespace 的直接 entry／alternate link，
  link 必須是設定 repo 的 HTTPS release 頁面，tag 符合 `<platform>-v<major>.<minor>.<patch>`。
  選 feed 中版號最高且大於目前版本者，不依發布順序判斷。XML 有 2 MiB 上限，拒絕 DTD／外部實體。
  Atom 沒有可靠的 prerelease 欄位，目前只支援已核准的 preview；其他頻道拒絕，不宣稱能排除預覽版。
  feed 是有限的近期列表；非空 feed 未列此平台時顯示來源資訊不足，不能假報已是最新。
- 更新資訊 URL 由設定 repo 與已驗證 tag 建立：`https://github.com/<repository>/releases/download/<tag>/work-fleet-update.json`，
  macOS 對應 `appcast.xml`。不使用整個 repo 的 `releases/latest`，不需要更新舊 release 的資產。
- 429 或帶 `Retry-After` 的 403 對應 rate_limited；一般 403 是 provider_rejected，不把所有來源拒絕誤報成配額耗盡。
- 每個 release 附 `work-fleet-update.json`：`schemaVersion`、`platform`、`version`、`tag`、`minimumOs`、`summary`，
  以及每個安裝檔的 `arch`、`name`、`size`、`sha256`。與 tag 或平台不符就拒絕整個版本。
  安裝檔 URL 同樣由 repo／tag／manifest 檔名建立；檔名只能是單層 ASCII 檔名，不可帶路徑、URL、查詢或 fragment。
  Atom 不提供 API 的 asset size；manifest 記錄預期大小，下載實際 bytes 必須相等，再驗證 SHA-256 與套件身分。
- 下載只用 HTTPS，不送憑證或 cookie。只允許有限次數轉到 GitHub release 資產主機（實作時以實測確認主機清單）；
  這是更新下載的限定例外，Google HTTP 規則不變。大小必須等於 manifest 並有上限，下載時計算 SHA-256，不符即刪除。
- 下載檔放在資料目錄的 `updates/`；安裝成功、版本被取代或檢查到已是最新時清除。

### 各平台安裝

- **Windows（MSIX）**：先從 MSIX 讀取 AppxManifest，核對 Name、Publisher、架構與更高版本。
  使用者按「重新啟動並安裝」後，走既有保存並結束流程：保存草稿、撤下場景並還原 Explorer、關閉資料並釋放 `owner.lock`。
  接著以 `PackageManager.AddPackageAsync` 搭配 `ForceApplicationShutdown` 安裝，並以 `RegisterApplicationRestart` 讓更新後重新開啟。
  更新自己的套件不需要 `packageManagement` 受限能力（2026-10-14 以測試身分實測）。Windows 只重新開啟執行滿 60 秒的程序。
  簽章與信任由 Windows 檢查，使用與既有預覽包相同的憑證。安裝失敗時重新開啟 App 並顯示錯誤；草稿已先保存。
  不使用預設停用的 `ms-appinstaller` 協定。Publisher 改變（正式憑證或 Store）不能就地更新，另行處理。
- **macOS**：Sparkle 2.10.0（MIT，2026-10-14 使用者選定）負責下載、驗證、替換與重新開啟，使用 Sparkle 的標準對話框
  （`SPUStandardUpdaterController`，含繁中）。原本考慮自訂 user driver，但約 15 個協定方法在沒有 Mac 的環境無法驗證，
  標準介面也是參考專案使用者熟悉的樣子。設定頁與選單列的「檢查更新」先以同一規則找出最新的 `macos-v` release，
  把該 release 的 `appcast.xml` 交給 Sparkle（`feedURLString(for:)`）再檢查；沒有更新的 release 直接回答已是最新。
  Sparkle 以 appcast 的 `sparkle:version` 比對 `CFBundleVersion`（`CURRENT_PROJECT_VERSION`），打包腳本同時寫入兩種版號。
  更新需 Sparkle EdDSA 簽章（公鑰 `WORK_FLEET_SPARKLE_PUBLIC_KEY` 進 Info.plist `SUPublicEDKey`）與相同 Team ID 的 Developer ID 公證版；
  沒有公鑰或不是 Developer ID 簽章時只顯示版本。App 保留沙盒（使用者 2026-10-14 選擇），依 Sparkle 沙盒說明加
  `SUEnableInstallerLauncherService` 與 `-spks`／`-spki` mach-lookup 暫時例外；已有 network.client，所以不開下載服務。
  自動檢查與自動更新關閉（Q01）。安裝時 Sparkle 結束 App，走既有保存並結束流程。未來 Mac App Store 版不得包含 Sparkle，
  上架時再分出不含 Sparkle 的建置（使用者同意）。第三方授權記入 THIRD-PARTY-NOTICES。
- **Linux（DEB）**：以 `dpkg-deb` 讀取並核對套件名稱、架構（`all` 或本機架構）與更高版本，在 App 執行中以
  `pkexec apt-get install -y <本機 DEB>` 安裝，讓 apt 補上新增的系統依賴；沒有 apt-get 時改用 `pkexec dpkg -i`。
  成功後保存並關閉資料，再沿用 ADR-040 的 `host.restart` 重新執行新版本。取消授權時維持執行並顯示 authorization_cancelled。
  不透過會帶入 NoNewPrivs 的重新啟動方式。

### 發布

- 每個平台的 GitHub Release 都使用 `<platform>-v<版號>` tag，並附安裝檔、`.sha256` 與 `work-fleet-update.json`。
  Windows 擴充 `windows-preview.yml`；macOS、Linux 在簽章與帳號條件完成後新增對應發布流程。
- 升版與 Actions dispatch 仍需使用者明確授權，發布後不得補 commit（AGENTS.md）。

### 隱私與安全文件

- GitHub 公開 Atom feed 與 release 資產主機列為網路目的地，只在使用者檢查或下載時連線；User-Agent 只含 App 名稱與版本。
- 更新 `docs/release/privacy.zh-TW.md`、`docs/release/submission-data.json` 與 `docs/security-guidelines.md`；
  GitHub 不是追蹤用途，`PrivacyInfo.xcprivacy` 的 tracking domains 不需新增。

## Consequences

### Positive

- 三個桌面平台都能在 App 內看到版本、檢查並升級，Windows 同時維持 MSIX 的資料與簽章模型。
- 不帶 token；所有判斷在原生 host，renderer 仍不能連外。
- 狀態與錯誤一致，系統匣與設定頁不會給出互相矛盾的結果。
- 不消耗未驗證 REST API 的每個出口 IP 每小時 60 次額度，公司共用 NAT 不會因此無法查更新。

### Negative

- 三種語言各自實作更新器，需要共用 fixture 測試同一份 feed／manifest 規則。
- macOS 依賴 Developer ID、公證、Sparkle 金鑰與新的發布流程；Linux 需要使用者授權安裝。
- Atom 是近期 release 列表，且沒有可靠的 prerelease 欄位。正式頻道（Q04）與超出 feed 範圍的長期平台更新需另設索引；
  目前拒絕不支援的頻道，未列平台時保留來源不足的錯誤。公開網頁仍可能被 GitHub 暫時拒絕或限流，不能宣稱無上限。
- SHA-256 與 manifest 來自同一個 release，只能防止損毀與替換單一檔案，不能防止 GitHub 帳號被盜；
  Windows 與 macOS 另有作業系統簽章檢查，Linux DEB 沒有。

### Neutral

- Repo 公開後，安裝檔與 CER 任何人都可下載。上架 Store 的版本由 Store 更新，屆時停用此更新器。

## Alternatives Considered

### Alternative 1: Windows App Installer（`.appinstaller`）

- **Pros**：Windows 原生，可設定開啟時自動檢查。
- **Cons**：需要固定的公開 `.appinstaller` 位置；更新由 App Installer 處理，無法先保存草稿與還原 Explorer，也無法共用三平台流程。
- **Why rejected**：以 App 內流程確保資料安全；之後如需背景更新可再評估。

### Alternative 2: 使用 `releases/latest` 或 Atom feed（2026-10-15 修訂）

- **Pros**：不使用 API 配額。
- **Cons**：`releases/latest` 跨平台共用且排除預覽；Atom 是近期列表、沒有可靠的 prerelease 欄位，需嚴格 XML 與來源驗證。
- **Decision**：採用 Atom，不使用 `releases/latest`。原先因平台獨立版號而拒絕 Atom 的理由不成立，host 可以自行篩選 tag。
  未驗證 REST API 按來源 IP 共用 60 次／小時，僅限制手動查詢無法解決公司 NAT 的問題，故移除 API 方案。

### Alternative 3: 私有 repo 加使用者 token

- **Pros**：repo 可維持私有。
- **Cons**：要在用戶端保存 GitHub token，且受 API 限制。
- **Why rejected**：維護者選擇公開 repo。

### Alternative 4: Linux 簽章 APT 套件庫

- **Pros**：系統更新器處理，套件有 GPG 簽章。
- **Cons**：需要另外維護套件庫與金鑰。
- **Why rejected**：本批先做 App 內 DEB 更新，套件庫列為後續選項。

### Alternative 5: macOS 自寫替換程式

- **Pros**：沒有第三方依賴。
- **Cons**：需自行處理執行中替換、權限、隔離屬性與簽章驗證，風險高。
- **Why rejected**：Sparkle 2 是成熟做法；使用者 2026-10-14 選定 Sparkle（SPEC-006 Q02）。

## References

- [SPEC-006](../specs/006-desktop-window-startup-and-updates.md)、[PLAN-006](../plans/006-desktop-window-startup-and-updates.md)、[研究](../resreach/2026-10-14-desktop-window-startup-and-update-reference.md)
- [ADR-028](028-native-package-and-signing-entry-points.md)、[ADR-032](032-windows-debug-webview-inspection.md)、[ADR-037](037-msix-data-lifetime-and-google-backup-overwrite.md)、[ADR-040](040-gnome-wayland-xwayland-choice.md)、[ADR-043](043-desktop-window-placement-and-startup-behavior.md)
- [GitHub REST releases](https://docs.github.com/en/rest/releases/releases)、[PackageManager.AddPackageAsync](https://learn.microsoft.com/en-us/uwp/api/windows.management.deployment.packagemanager.addpackageasync)、[Sparkle](https://sparkle-project.org/documentation/)

---

*Decision made: 2026-10-14*
*Decision makers: 維護者*
