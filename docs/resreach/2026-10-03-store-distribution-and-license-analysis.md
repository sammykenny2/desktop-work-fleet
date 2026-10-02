# 商店發佈、跨平台能力與授權研究

- 日期：2026-10-03；外部政策查閱日同日。
- 狀態：選型前研究，沒有任何平台的送審或核准結果。
- 使用者要求：iOS、macOS、Android 自有 App 上架；Windows 尚不購買商業簽章憑證；Linux 發佈範圍務實限定。
- 本文列出採用與發佈的檢查邊界，不把單一根目錄 license 當作全部產物的合規證明。

## 1. 已知發佈目標

| 平台 | 路徑 | 本次判斷 | 未完成工作 |
|---|---|---|---|
| macOS | Mac App Store | 必須從公開 API 與 sandbox 相容性出發 | 桌面層探針、簽章、打包與送審 |
| iOS | Apple App Store | 需要實際可用的記錄／編輯客戶端 | 手機 UX、同步、配對與發佈設定 |
| Android | Google Play | AAB／Play App Signing 為候選標準路徑 | App 實作、金鑰保管、帳號與測試資格 |
| Windows | Microsoft Store，優先評估 MSIX | Store 簽章路徑符合目前不買憑證的偏好 | MSIX 相容性、桌面互動與認證測試 |
| Linux | GitHub Releases 起步 | 可作交付通路，但不等於支援所有 distro | 決定 distro、CPU、桌面／compositor 與封裝矩陣 |

Web 可用於早期 UX 驗證或額外編輯入口；不替代已表達的行動商店需求。

## 2. Apple：公開 API、sandbox 與可審查性

Apple 的規則要求使用公開 API；Mac App Store 另有 sandbox 與更新方式要求。動態下載功能程式碼受到限制，4.7 對部分 HTML5／JavaScript 軟體與 plug-in 有條件規範，不應解讀成所有外部 JS 都必定禁止或必定允許。需要登入或配對的 App 也需讓審查人員可實際存取。[Apple Review Guidelines，2.4.5／2.5／4.7 與 Before You Submit](https://developer.apple.com/app-store/review/guidelines/)

本專案的候選落實方式：

- 首版功能程式碼隨 App 交付，同步取得的是筆記與設定資料。
- 不把遠端下載的任意 JS 外掛當成第一版功能。
- 配對與 server 部署需提供可重現的 review 方式，不能只在開發者私人 LAN 上可用。
- 公開 API 桌面能力以獨立原型驗證，參考 [macOS 研究](2026-10-03-macos-public-api-desktop-feasibility.md)。
- 若採跨平台框架，檢查最終發佈產物，不只看應用程式碼是否寫了 private API。

以上是目前研究提出的實作策略，沒有承諾一定通過審查。

## 3. Windows：MSIX 與 EXE／MSI 分開評估

Microsoft 的 MSIX 簽章文件說明，透過 Store 發佈時由 Store 簽署套件；開發者不需要為這條路徑自行購買用於公開散布的 CA code-signing 憑證。[MSIX 簽章說明](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide)

不能把這個結論擴大成「任何 EXE 上架 Store 都免費代簽」。官方 package requirements 對 MSI／EXE 的簽章另有要求；部分 certification 頁面用 highly recommended 措辭。正式採 EXE／MSI 路徑前，需再次確認該提交方式的最新條件。[Package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/app-package-requirements?pivots=store-installer-msix)、[MSI／EXE certification](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-certification-process)

本案優先驗證 MSIX 的原因是使用者的憑證偏好，不代表已證明桌面整合可在該封裝中工作。應測安裝、啟動、更新、移除、系統匣、資料位置與桌面層。開發／側載簽章和商店發佈簽章也需分開。

不會在本次 bootstrap 建立或匯出任何簽章金鑰。

## 4. Android：發佈與動態程式碼

Android 的 upload key 與 App signing key 是不同用途。使用 AAB 時由開發者簽署上傳包，再由 Play App Signing 處理使用者安裝產物的簽章。[Android App Signing](https://developer.android.com/studio/publish/app-signing)

新個人帳號的 production access 可能需要 closed testing；官方目前對 2023-11-13 後建立的個人帳號列出至少 12 位連續加入 14 天的測試者等要求。是否適用取決於帳號條件，不能把完成天數當成自動核准。[Google Play 測試要求](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)

Google 對從 Play 外下載可執行程式碼設有限制；interpreted code 有特定處理方式，但仍須符合全部政策。外掛是否使用 JavaScript，不能單獨決定合規。[Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)

本案先把外掛與任意遠端程式碼執行排除於第一版候選範圍。一般資料同步與動態執行功能應分開分析。

## 5. Linux：支援矩陣比套件副檔名重要

GitHub Releases 可以發布檔案、說明與校驗值，但發佈頁面不提供執行相容性的保證。

需要同時記錄：

- Distribution 與版本。
- CPU architecture。
- X11 或 Wayland。
- 桌面環境與 compositor。
- Runtime 相依套件及封裝格式。
- 哪種呈現層級、滑鼠穿透與快捷鍵實際通過。

wlr-layer-shell 的協定提供 background、bottom、top、overlay 等 layer；只有支援該協定的環境才能依此實作，同層表面的相對排序也不能假定固定。[協定文字](https://wayland.app/protocols/wlr-layer-shell-unstable-v1)

因此本案的工程推論是：一般編輯視窗與特殊桌面展示能力應分開列出支援等級。不能因某個 Wayland compositor 成功，就宣稱所有 Wayland、GNOME、KDE 或 X11 都成功。

候選起步方式是在一個可取得的 distro／CPU／桌面組合驗證套件，再逐步擴大。deb、AppImage、Flatpak 都只是候選包裝，沒有在本次選定；任一包裝都不能替未支援的 compositor 補出相同層級能力。

## 6. 獨立開發與授權邊界

本專案使用 project-bootstrap 的 minimal 骨架；產品研究文件重新撰寫，沒有帶入其他 sticky-note 應用的程式碼、資產、lockfile、資料格式或平台模組。

目前根目錄採用 bootstrap 的 MIT 授權，保留來源聲明並新增本專案原創部分的聲明。此處的 MIT 不會把後續加入的第三方元件重新授權。

MIT 允許廣泛使用、修改與散布，但需保留相關 copyright 與 permission notice。[MIT 原文](https://opensource.org/license/mit)

本次只記錄已實際帶入的 bootstrap 來源，見 [第三方聲明](../../THIRD-PARTY-NOTICES.md)。不需要為沒有複製或連結的候選產品假設已存在的程式碼依賴。

## 7. 候選元件的授權辨識

| 類別 | 研究結果 | 對選型的含意 |
|---|---|---|
| MIT／BSD／ISC／Apache 類元件 | 仍需逐項讀授權與 notices | 可考慮，不能只保留自己 repo 的 LICENSE |
| MPL-2.0 | 有涵蓋檔案與 source availability 義務 | 不等於整個 App 必須改成 MPL；需追蹤被散布部分 |
| GPL／AGPL | 要評估改作、組合、再散布與網路使用義務 | 不把它們當成可以直接改掛 MIT 的原始碼 |
| Obsidian 本體 | 適用其軟體條款 | 不作為可任意 fork／重包裝的 MIT App |
| Vikunja | 主體 AGPL-3.0-or-later；desktop GPL-3.0-or-later | 自架、修改、API client 與複製 UI 必須分開評估 |

來源：[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[AGPL 原文](https://www.gnu.org/licenses/agpl-3.0.html)、[Obsidian 條款](https://obsidian.md/terms)、[Vikunja 授權](https://github.com/go-vikunja/vikunja#license)。

AGPL 對修改後且支援網路互動的程式有提供相應原始碼的要求；獨立 client 是否構成受涵蓋的組合作品，仍須依實際採用方式判定。不能用「只是 HTTP」當作自動豁免，也不能把所有 HTTP client 一概認定受 AGPL。

## 8. 選定技術棧後的授權工作

這是一份未執行的後續檢查清單：

1. 鎖定實際版本與完整相依清單。
2. 分辨 build tool、測試工具、runtime、靜態／動態連結及平台限定元件。
3. 取得 SPDX 表達式、完整 license 與必要 notices。
4. 對 copyleft、字型、圖示、圖片與 SDK 另做具體判斷。
5. 檢查各商店實際散布的產物，建立對應聲明與原始碼提供方式。
6. 在版本變更、增加依賴或送審前重查。

先前對其他程式的任何套件掃描不能沿用成這個新 repo 的稽核結果。目前沒有產品 dependency manifest，因此沒有完成 runtime SBOM 或商店相容性稽核。

## 9. 需要提早阻擋的誤判

- 依賴 macOS private API 的產品路徑，不符合目前 Mac App Store 方向。
- 沒有授權的原始碼／資產不能直接複製再重新上架。
- 單一 OS 探針不能支持全平台能力承諾。
- 未測的 runtime、商店審核與同步可靠性必須維持未驗證狀態。

除此之外，目前沒有證據要求放棄「公開 API、跨裝置、簡單 backlog」這個產品方向。
