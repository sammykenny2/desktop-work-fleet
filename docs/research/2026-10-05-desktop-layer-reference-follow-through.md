# 桌面分層：接續參考原生成果

日期：2026-10-05。來源為維護者提供的輔助參考 checkout；位置不寫入本 repo。
這是行為與失敗證據核對，沒有把參考 source、UI、asset 或 schema 移植到本產品。

## 已讀證據

- Linux 2026-10-02 layer-shell 問題報告，含 2026-10-03 input shape／tray 補充、實機結果與未解項目。
- Linux 2026-10-02 Debian 打包、命令列操作及已知限制報告。
- macOS 2026-04-14 desktop／wallpaper 分流修正；Windows 2026-04-14 Explorer 層語意修正。
- Linux 原生 layer surface 的層級、geometry、size request、input shape、queue draw 與重畫入口。
- 本機專案已有的 SPEC-003、ADR-023／025／030 與跨平台 feasibility 研究。

## 參考實測，非本產品通過結果

Linux 實測環境是 Pi 5、Raspberry Pi OS／Debian 13 arm64、labwc 0.20.2／wlroots 0.20、
pcmanfm-pi 1.11、WebKitGTK 2.54、gtk-layer-shell 0.9.0。
報告包含真實桌面截圖、Wayland protocol trace、virtual pointer／uinput 及独立 GTK/WebKit 重現。
桌面 BOTTOM、操作 TOP 與背景 BACKGROUND 已切換；快／慢四次拖曳與指標位移一致，
就地編輯可輸入保存，切層／重新顯示後畫面完整，日常穿透可抵達 pcmanfm。

與本產品相關的修正是 DMA-BUF／V3D corruption、透明 WebKit damage、size request、
GTK allocation 覆蓋 GdkWindow input shape、更新 region 後需產生 frame。
本產品使用每螢幕共同場景，卡片在 renderer 內移動，因此不搬 native surface，
不需要參考的一卡一窗 margin 移動與 pointer settle 算法；仍使用 viewport-local 指標轉換。

報告未解的是 pcmanfm 的桌布／圖示合一，BACKGROUND 無法插到圖示下方；
雙螢幕 Pi 與部分透明效果沒有實測。GNOME／X11 不走這個 layer-shell 後端。
快捷鍵及 tray 的外部報告不等於本產品 portal／system tray 已在 Pi 通過。

## 本產品決策及驗證

[ADR-031](../decisions/031-macos-and-linux-wallpaper-scenes.md) 加入 Mac 第三層及 Linux BACKGROUND，
同步修正 input shape 與重畫。新測試直接使用本產品原生來源與共用核心合成投影。
結果、版本及未測界線只記於 [PROGRESS](../../PROGRESS.md)。
