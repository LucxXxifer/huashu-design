# 本機驗收工具

從 `SKILL.md` 所在資料夾執行 `node scripts/huashu.cjs <命令> <job.json> <新結果目錄>`。用 Codex workspace dependencies 回傳的 Node（本機實測 24）和 `HUASHU_NODE_MODULES`；若未設定，會查 Node 模組路徑與常見的本機 Codex bundle。瀏覽器需要 Node Playwright＋現有 Chromium；macOS 優先用現有 Chrome，可用 `HUASHU_CHROMIUM` 指定。`deck` 若做 PDF 要有 pdf-lib 和 `pdftotext`，PPTX 另用 pptxgenjs、jszip、xml-js；切片用 Sharp；影片用 FFmpeg、ffprobe。可用 `HUASHU_PDFTOTEXT`、`HUASHU_FFMPEG`、`HUASHU_FFPROBE` 指定各執行檔，缺件時不自動安裝或改權限。

素材路徑相對於 `job.json`，要放在其資料夾內，禁止跳出或用 symlink 繞過。結果目錄的父層需存在，本身必須新建；舊證據不可混用。用自己創作或已信任的 HTML 及資產：開獨立 Chrome context、沒有登入資料，以離線攔截載入本地資源，外部資源會報錯。已驗證的外部圖／字體／套件先按授權放進專案，不默許 CDN、資料傳出或全域安裝。此步是本地測試工具，不承諾可執行不明來源程式。

`result.json` 是當次證據：`passed=0`、`failed=1`、`skipped=2`（缺依賴）、`partial=3`（做了一部分）。一般用法錯誤或拒絕覆蓋舊目錄只回 stderr 與非零，不另寫入舊目錄。只有在 `artifacts` 列出的檔可供審閱；圖片可能是失敗的診斷證據。重要成品要讀各格式檢查和狀態，不能只看副檔名或成功字樣。

## web

```json
{"file":"index.html","viewports":[[1440,900],[375,812]],"steps":[{"click":"#start"},{"fill":"input","value":"draft"},{"press":"input","key":"Enter"},{"expect":"[role=status]","text":"Saved","screenshot":true},{"reload":true},{"expect":"input","value":"draft"}]}
```

`expect` 路徑可加 `attribute`/`equals` 核對狀態；`minFontPx` 預設 12。檢查初始與各指定狀態的溢出、可讀性、缺圖、例外與 console。對簡單純色做文字對比；未量到的透明／背景圖等個案記在 `contrastUnmeasured`，用原畫面判斷。流程只跑你寫下的操作，不推論全站或完整無障礙通過。

## deck

```json
{"size":[960,540],"pptx":"native","slides":[{"file":"01.html","text":["Working tree"],"native":{"background":"F4F0E7","items":[{"type":"text","value":"Working tree","box":[40,60,880,68],"fontSize":48,"color":"182824","bold":true}]}}]}
```

`size` 與 `box=[x,y,w,h]`、`fontSize` 都以 CSS 像素表示。`pptx` 為 `none`（沒 native 時預設）、`native` 或 `raster`。原生物件另有 `rect`／`ellipse`（`fill`／`line` RGB）、`image`（PNG／JPEG `file`），文字另有 `fontFace`／`align`／`valign`。`text` 要列獨立的必讀字串，不能從匯出後檔案取來回填；圖像頁可填 `[]`，另記必需素材並目視。`slide-*.png` 是瀏覽器畫面，不等於 Office 或 Poppler 的重開結果。

## images

```json
{"file":"long.png","size":[1080,3600],"cuts":[0,1200,2400,3600]}
```

同尺寸批次用 `files`、`count`，若要求無 alpha channel 加 `requireOpaque: true`。切一張長圖用 `cuts` 指定從 0 到全高的列範圍。切片會重新解碼並逐像素比對累計的內容與順序；不把像素完整當成文字沒被切斷。

## video

```json
{"file":"timeline.html","width":960,"height":540,"seconds":8,"fps":24,"requireNarration":true,"samples":[2.5],"tracks":[{"role":"narration","file":"voice.wav","start":1,"end":4.615,"gain":1},{"role":"music","file":"bed.mp3","start":0,"end":8,"gain":0.22,"loop":true}]}
```

尺寸用偶數；秒數與 fps 乘積需整數。`requireNarration`、`requiredAudioRoles` 用來明示不能省略的 `narration`／`music`／`sfx`。`start`／`end` 來自實際音檔時長與分鏡；旁白需照順序且不重疊，單段音長與 cue 差不超過 80ms，不更改講者速度。只有音樂可循環播放。GIF 另由已驗 MP4 輸出。不依賴瀏覽器聲軌錄製；HTML 若需影音播放，另使用相同時間軸與音檔核對播放。

## gate

```json
{"scope":"project","kind":"selection","direction":"B","evidence":{"source":"user","turn":"user:17","quote":"選 B"}}
```

`kind: "waiver"` 用明確跳過三稿的原話。小工具只承認少數完整句型（「選 B」「就用方向 B」「跳過三稿」「Choose direction B」「Skip the three drafts」），不做語義推理。自然語句的明確選擇以真原文與專案記錄人工核對，保留原話，不改寫成假證據。正式 `gate` 拒絕 fixture；`--fixture` 只驗 `scope/source: "fixture"`，不授權正式工作。同案迭代與非設計機械操作在紀錄寫理由，不偽造新選擇。
