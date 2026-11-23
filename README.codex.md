# 花叔設計 Codex 專用版

`huashu-design-codex` 0.2.0 對應 `alchaincyf/huashu-design` v3.5.0（`937113133ae446a69ea19d4ceed6cbd2ed3c7735`），提供微信小程序設計交接、原版展示板與離線 HTML。WorkBuddy 的原生小程序流程可讀取交接包。

解壓後，Skill 位於 `huashu-design-codex/skills/huashu-design-codex/`；可將這個 Skill 資料夾放進 Codex 個人 Skills 路徑，或先在工作區試用。入口在 `SKILL.md`，再按工作閱讀相關媒介參考。若放入正式 Skills 路徑，先確認目標並保留既有檔案。

## 本機驗收

在 macOS 的 fork 原始碼目錄，以 Node.js 24 執行 `npm --prefix codex ci --ignore-scripts` 和 `npm --prefix codex test`。測試另需 Git、Chrome 或 Chromium、FFmpeg 及 Poppler。可用 `HUASHU_CHROMIUM`、`HUASHU_FFMPEG`、`HUASHU_FFPROBE`、`HUASHU_PDFTOTEXT` 指定執行檔。測試涵蓋隔離的 Git 教學、Web、長圖、PDF/PPTX、影片、微信交接、離線 HTML 和實際 ZIP。

Release 的 ZIP 附獨立的 `runtime/` 資料夾。將其中的 `package.json` 和 `package-lock.json` 放到 `~/.local/share/huashu-design-codex/runtime-0.2.0`，用 Node 24 執行 `npm --prefix "$HOME/.local/share/huashu-design-codex/runtime-0.2.0" ci --include=dev --ignore-scripts` 安裝鎖定版本。也可將 `HUASHU_NODE_MODULES` 指向已準備好的同一份鎖定依賴。執行格式見 [runtime.md](skills/huashu-design-codex/references/runtime.md)。

## 從 GitHub 更新

在此 fork 的 **Releases** 取得 `huashu-design-codex.zip`、`SHA256SUMS` 和 `PACKAGE-MANIFEST.json`。解壓前先執行 `shasum -a 256 -c SHA256SUMS`。上游標籤、提交、特化分支提交與相容性報告都在當次 Release 或 Actions 的摘要中。

**Check Huashu upstream and publish Codex edition** 每日檢查官方穩定發行。相容性規則在 `codex/upstream-policy.json`。共用 JSX 的等價修改及指定樣式微調會進入候選包，已對應的宿主工具會沿用。出現新合約、依賴變化或未辨識的功能時，Actions 會提供逐檔報告。審查並補上程式和測試後，同步更新規則基準與 Skill 的上游固定版本，再執行一次 Actions。相容候選包通過測試後會出現在 Releases。

固定 fixtures 僅用於測試，不作方向選擇或產品審核證據。機械檢查仍不代替設計師的實際視覺和聽覺評審、使用者選擇或真人錄音；本機合成配音只用在具標記的非生產測試。

上游 MIT 授權全文見 [LICENSE.upstream](LICENSE.upstream)。樣例使用 Jason Long 創作的 [Git 標誌](https://git-scm.com/downloads/logos)，授權為 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，頁面也附署名。[Pro Git 圖解](https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F) 由 Scott Chacon 和 Ben Straub 創作，依 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 使用。樣例與素材均位於 Skill 內的 `samples/git-desk/`。
