# 花叔設計 Codex 專用版

本包是針對固定上游 `alchaincyf/huashu-design` commit `c4cc21943a8026d2d7aa33bd56b72b5be1926923` 的 Codex 相容層。它不會修改、安裝或自動同步共用 Skill，也不會把 Claude 專用 CLI 當作 Codex 工具。

解壓後，Skill 位於 `huashu-design-codex/skills/huashu-design-codex/`；可將這個 Skill 資料夾放進 Codex 個人 Skills 路徑，或先在工作區試用。入口在 `SKILL.md`，再按工作閱讀相關媒介參考。若放入正式 Skills 路徑，先確認目標並保留既有檔案。

## 本機驗收

在 macOS 的 fork 原始碼目錄，以 Node.js 24 執行 `npm --prefix codex ci --ignore-scripts` 和 `npm --prefix codex test`。測試另需 Git、Chrome 或 Chromium、FFmpeg 及 Poppler；不在預設位置時，以 `HUASHU_CHROMIUM`、`HUASHU_FFMPEG`、`HUASHU_FFPROBE`、`HUASHU_PDFTOTEXT` 指定。測試涵蓋隔離的 Git 教學、Web、長圖、PDF/PPTX、影片和實際 ZIP；缺少必要依賴會失敗。使用解壓後的 Skill 時，依 `references/runtime.md` 設定驗收工具；ZIP 不附 Node 依賴。

固定 fixtures 僅用於測試，不作方向選擇或產品審核證據。機械檢查仍不代替設計師的實際視覺和聽覺評審、使用者選擇或真人錄音；本機合成配音只用在具標記的非生產測試。

上游 MIT 授權全文見 [LICENSE.upstream](LICENSE.upstream)。樣例使用 Jason Long 創作的 [Git 標誌](https://git-scm.com/downloads/logos)，授權為 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，頁面也附署名。[Pro Git 圖解](https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F) 由 Scott Chacon 和 Ben Straub 創作，依 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 使用。樣例與素材均位於 Skill 內的 `samples/git-desk/`。
