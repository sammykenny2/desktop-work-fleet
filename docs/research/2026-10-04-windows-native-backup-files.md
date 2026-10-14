# Windows 原生備份檔案與加密研究

查閱：2026-10-04。只依官方公開 API 文件；未搬入外部應用程式碼或資料契約。
決策在 [ADR-016](../decisions/016-windows-native-backup-files-and-vault.md)，實際執行狀態在 [PROGRESS](../../PROGRESS.md)。

## 官方證據

- `CreateFile` 的 create-new 會拒絕既有檔案；share 模式影響其他開啟／write／delete，
  rename 也需要 delete access。[CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- Windows SDK user-mode `NtCreateFile` 接受 `OBJECT_ATTRIBUTES.RootDirectory`，可相對已開啟目錄操作；
  `FILE_CREATE` 是只建立新檔的 disposition。
  [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
- `OBJ_DONT_REPARSE` 可拒絕名稱解析遇到的 reparse point。
  [OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes)
- 檔案 disposition 可透過已開啟的 handle 設定；仍有其他 handle 時，實際消失可能延後至關閉。
  [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、
  [FILE_DISPOSITION_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_disposition_info)
- .NET `AesGcm.Encrypt` 分別輸出 ciphertext 與 tag，支援 AAD；同 key 的 nonce 不可重用。
  [AesGcm.Encrypt](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.aesgcm.encrypt)
- .NET 提供 PBKDF2 的 byte input 與 SHA256 選擇；使用明確 UTF-8，不做密碼正規化。
  [Rfc2898DeriveBytes.Pbkdf2](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.rfc2898derivebytes.pbkdf2)
- ZIP 使用 BCL `ZipArchive`／NoCompression 封裝固定兩個檔名，實際產物另交嚴格共用 reader 驗證。
  [ZipArchive](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.ziparchive)、
  [CompressionLevel](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.compressionlevel)

## 工程判斷與本機觀察

單純防止最末端 symlink 不足以阻止祖先改名後重新解析到其他位置；採用持有的 directory handle。
重啟需重新建立能力，因此保存 Volume GUID 路徑後比對原生身分。Windows volume GUID namespace
本身經 system mapping；只用 Win32 開啟該 volume root，再相對它以 no-reparse 開啟保存的目錄。
第一版直接對整條 GUID native path 使用 no-reparse 會實際收到 4395，已由真 NTFS probe 複現並修正。

測試涵蓋同名不覆寫、寫入／rename 競爭、修改／同 bytes 換檔保留、同 handle hash→delete、
取消留下部分檔、traversal／ADS 拒絕、資料夾替換拒絕及祖先改名不改變持有的目的地。
native vault 加密的中文／emoji 密碼與完整內容由 WebCrypto reader 還原；測試 stdio
明確使用 UTF-8，避免 Windows console codepage 誤改 password fixture。

獨立對抗測試另發現：驗證最新備份後立刻放開 handle，會讓另一程序趁舊檔 hash 期間改掉最新檔。
改為持有最新檔的 write/delete 排斥鎖，直到舊檔 disposition 完成；原競爭探針重測阻擋改寫。
SQLite 身分 reservation 失敗後的空新檔必須列為 unconfirmed，不能與「尚未建立」混為一談。

## 驗證界線

WPF probe 只替換互動式資料夾選擇結果，後續原生 IPC／DPAPI／SQLite／NTFS／加密皆實際執行。
尚未自動操作真實 OS picker、測外接磁碟斷線／斷電、所有最低版本 Windows 或商店 sandbox。
NTFS 以外 backend 不自行宣告等價保證；其他平台需各自實作及驗收。
