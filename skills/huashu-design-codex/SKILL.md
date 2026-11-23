---
name: huashu-design-codex
description: Use when the user requests the Codex edition of 花叔設計 / huashu-design for high-fidelity HTML or WeChat mini-program prototypes, decks, infographic or store images, motion design, narrated explainers, or visual critique.
metadata:
  version: "0.2.0"
  upstream-version: "3.5.0"
  upstream-commit: 937113133ae446a69ea19d4ceed6cbd2ed3c7735
---

# 花叔設計 · Codex 版

以真素材和可比較的作品做設計決策。先讀當前專案的簡報、設計系統、畫面與既有選稿。用一份專案進度記錄串起事實、方向、素材、修改和驗收；不為舊版 `TaskCreate` 增加任務服務。

1. **核實事實與素材。** 對具名產品、版本、功能、事件，先用本回合可用搜尋（例如 Magpie）找到官方原文，記主張與來源到 `product-facts.md`。有具名品牌就逐一找官方標誌、圖與規範，記入 `brand-spec.md`；優先使用真產品截圖和使用者既有資產。關鍵事實、授權或畫面缺失就明記；需要實際圖片的地方不以 emoji、灰框或隨手 SVG 代填。生圖只用本回合已具備的工具，核對參考圖是否確實傳入和輸出是否存在；需要指定服務、付費或傳出素材時說清楚。題材的資料圖與程序化材質可以本地製作。
2. **逐屏答 form 五問。** 這屏負責什麼敘事？與觀眾多近？什麼溫度？應容納多少資訊？哪個母題只屬於這個題材？用一句話把形式連回內容。評審與機械轉檔直接讀對應段落。
3. **六卡、三稿、選方向。** 設計師、同媒介真實參照、風格樣張各兩卡；看參照圖、量結構，記借用的機制和不沿用的表達。挑三個結構不同的方向，做對應媒介的真稿；每稿看自己的實際畫面、修一輪，再展示。只有換色、只畫縮圖板或只描述想法都不算三稿。對照來源確認不像同一品牌換皮。
4. **到選擇點就停。** 給 A/B/C、作品連結與差異，等待使用者選擇。「繼續」「趕時間」「指定 Apple 風格」都不算已選或豁免。只有本次明說跳過、同一專案既選方向內的迭代、純機械操作可以略過，原話或理由記在 `direction-approved.md`。不要將助手、測試資料或其他專案的選擇當真人批准。`gate` 只核對結構與明確用語，沒有宿主強制攔截功能。
5. **全稿做完再打磨與驗收。** 至少兩輪：打開所有屏／頁或代表鏡頭與轉場，先修最傷的地方，重出圖並記變化；再單獨檢查實際交付檔。技術檢查 `passed` 仍須看圖；`skipped`、`partial`、缺素材、未測互動或未聽旁白照實列出。不要以 HTML 正常推論 PDF／PPTX／MP4 可用。

| 作業 | 讀取 |
|---|---|
| 方向卡、真稿規格、停點、逐屏評審 | [流程與評審](references/workflow.md) |
| Web、dashboard、App、Tweaks、資訊圖與連續圖／商店圖 | [頁面與圖片](references/screens.md) |
| 微信小程序原型、展示板與 WorkBuddy 工程交接 | [微信小程序](references/miniprogram.md) |
| 斷網可開、含素材的單檔 HTML | [離線輸出](references/runtime.md#offline) |
| HTML Deck、PDF、可編輯或保留外觀的 PPTX | [簡報](references/deck.md) |
| 短片、長解說、TTS、cue、MP4／GIF | [動態與音訊](references/motion.md) |
| 本機命令和結果判讀 | [驗收工具](references/runtime.md)；只讀當前命令段 |
| 原版範例、設計素材與進階技法 | [固定上游索引](references/upstream.md)；依媒介選讀 |

用現有專案記錄維持進度。需要釐清需求才用 Cyber SOP；需要工程實作拆解才用 Superpowers，沿用同一份記錄。作者水印、通用配額、全域記憶、外部上傳和安裝不屬於預設交付。

發佈封裝的 Skill 路徑只含 `scripts/package-files.txt` 所列檔案。ZIP 另附 README、授權與專用 Node 依賴的清單及鎖檔。修改發佈內容時，同步更新清單並執行封裝校驗。
