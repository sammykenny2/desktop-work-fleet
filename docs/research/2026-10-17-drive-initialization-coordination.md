# Drive 初始化協調：證據與採納決策

查核日期：2026-10-17。僅查閱 Google 官方文件，未操作使用者帳號。

## Evidence

- [File resource 的 name](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)：名稱在資料夾內不保證唯一；同名 init 檔不能充當唯一鍵。
- [預產生 ID 的上傳重試](https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files)：已知 file ID 可安全重試；既存 ID 回 409。
  此機制不把不同裝置各自配置的 ID 合成同一筆。
- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)：提供 incompleteSearch；列舉不完整時不能據此認定所有資料已清空。

## Proposal and Decision

由上述限制推導：不採同名檔或先到先贏的隱含鎖，改用可驗證、不可變的 prepare／ready。
這是本專案的協定設計，不是 Google 提供的原子初始化 API。已採納於 [ADR-054](../decisions/054-explicit-workspace-initialization.md)。
新帳號共享確定性計畫；破壞性重設僅由持有 durable journal 的發起端續行，followers 等待。
