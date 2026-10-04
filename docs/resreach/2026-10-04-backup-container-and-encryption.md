# 備份容器與加密依據

查閱：2026-10-04。外部證據、設計選擇及實測範圍分開；採用決策見 ADR-013。

## 外部證據

- [PKWARE ZIP APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) 定義 local／central header、
  CRC、size、data descriptor 及 UTF-8 路徑。descriptor signature 可省略；本 reader 按實際邊界辨識，
  避免 CRC 恰等 signature 的歧義。ASCII 路徑白名單、extra field 限制及拒絕 ZIP64 是產品選擇。
- [fflate 官方專案](https://github.com/101arrowz/fflate) 提供 browser ES module 及 ZIP 串流 writer，MIT 授權。
  本次固定 0.8.3 並封裝 LICENSE；沒有複製其他產品程式或資料契約。
- [WHATWG Compression Streams](https://compression.spec.whatwg.org/) 規定 deflate-raw 遵循 RFC1951，
  非法 block、未完整結束及 final block 後多餘 bytes 應失敗。本 reader 使用原生串流並限制輸出 bytes。
- [Node Web Streams](https://nodejs.org/api/webstreams.html#class-decompressionstream) 記錄 deflate-raw
  自 21.2.0／20.12.0 支援，因此 Node >=22 下限不需調高；實測版本見 PROGRESS。
- [Safari 16.4 WebKit 公告](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/) 宣告 Compression Streams。
  這不單獨證明所有目標 WKWebView 的 deflate-raw 行為；仍需 capability check 及實機 probe。
- [Web Cryptography 規格](https://www.w3.org/TR/webcrypto/) 定義 PBKDF2、AES-GCM 與 nonextractable CryptoKey。
  容器使用標準運算及 authenticated additional data，沒有自有 cipher。
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
  列 PBKDF2-HMAC-SHA256 600,000 工作因子；該頁一般優先 Argon2id。
  本產品因 WebCrypto 可攜性選 PBKDF2，不把引用當 OWASP 格式認證或 FIPS 合規宣稱。

## 實驗的意義

惡意 ZIP 包含錯 NLEN、未結束 DEFLATE、compressed 尾垃圾、BOM 名稱、CRC/signature 碰撞。
寬容解壓器接受的錯誤改由原生 DecompressionStream 拒絕；stored 大檔分塊 CRC 並讓出取消事件。
Python 標準庫 zipfile 另讀輸出；獨立 OpenSSL／WebCrypto 雙向測試檢查 KDF、AAD 及 GCM tag。
這些是容器互通／錯誤處理證據，不是 Google、原生檔案持久性或完整五平台驗收。

## 決策及尚待驗證

[SPEC-002](../specs/002-portable-backup-and-restore.md) 定義完整格式、三種還原及自動備份。
128 MiB expanded 等限制是防止無界分配的工程選擇，最低手機／五平台容量仍須實測。
密碼安全儲存、自動排程／OS 暫停、原子檔案保存及還原交易各自需故障驗收。
狀態只記 [PROGRESS](../../PROGRESS.md)，不由研究推定已實作。
