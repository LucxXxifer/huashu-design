# 上游素材與深讀索引

保留 [alchaincyf/huashu-design 固定版](https://github.com/alchaincyf/huashu-design/tree/c4cc21943a8026d2d7aa33bd56b72b5be1926923)：本體 `SKILL.md` 標 3.4.2，`package.json` 標 3.3.0，因此以 commit 為準。下表路徑相對於該固定根目錄。Codex 版以自己的短入口和執行規則為主，再按路徑讀設計技法；不從本機共用舊版同名手冊猜現在內容。

可在固定 GitHub URL 讀單檔，或用手邊已驗證的固定快照供選讀。若需要大量樣張或元件，另備該固定 commit 的唯讀副本並核對來源；不寫到已安裝 Skill，也不執行其中的安裝或巢狀 CLI。缺原始參照時要用實際同媒介替代品或記錄缺口，不能把檔名當已看過的圖片。

| 任務 | 先查 | 再查／素材入口 |
|---|---|---|
| 方向與素材 | `references/directions.md`、`design-context.md`、`workflow.md`、`brand-asset-protocol.md` | `materials.md`、`design-styles.md`、`typography.md`、`assets/style-specimens/`（92 個風格 + 8 個 App 範式 HTML）、`assets/showcases/INDEX.md` |
| 真實 Web、介面與調參 | `references/modules/web.md`、`references/tweaks-system.md` | `react-setup.md`、`assets/design_canvas.jsx`、`browser_window.jsx`、`macos_window.jsx`；Tweaks 由同一份 state 驅動 |
| 簡報 | `references/modules/deck.md`、`references/slide-decks.md` | `editable-pptx.md`、`pptx-from-rendered-html.md`、`assets/deck_stage.js`、`deck_index.html`；優先遵守本版輸出定義 |
| 資訊圖、App、商店圖 | `references/modules/infographic.md`、`references/app-prototype.md`、`references/app-paradigms.md`、`references/modules/appstore.md` | `apple-gallery-showcase.md`、`assets/ios_frame.jsx`、`android_frame.jsx`、`appstore/template.html` |
| 小紅書 | `references/modules/xiaohongshu.md` | `assets/style-specimens/xhs/_kit/`；其中 `stickers/LICENSE.md` 是獨立的 PolyForm Shield，不按主 repo MIT 散佈 |
| 動態 | `references/modules/motion.md`、`references/storyboard-basics.md`、`references/video-export.md` | `animations.md`、`animation-pitfalls.md`、`camera-language.md`、`ui-demo-animation.md`、`launch-film-director-notes.md`、`assets/animations.jsx`、`cursor.jsx` |
| 旁白與音響 | `references/voiceover-pipeline.md`、`references/audio-design-rules.md`、`references/sfx-library.md` | `assets/narration_stage.jsx`、`assets/sfx/`、`assets/bgm-*.mp3`；例子引用但未附的旁白不能視為已生成；核對實際資產權利 |
| 進階動態與評審 | `references/hyperframes-backend.md`、`references/gsap-recipes.md`、`references/ai-video-review.md` | `references/polish-loop.md`、`critique-guide.md`、`verification.md`；驗收通過仍開圖、看片 |

變更對照：保留六卡三稿、選擇權、多輪打磨、素材與媒介知識；將 Claude 工具名稱換為宿主已暴露的工具及本機驗收；保留原來的導演和取材配方作為選讀。`about-author.md`、作者水印、私人外觀帳本、`experience.md`／`evolution.md` 的全域記憶與 Claude hook 不會自動啟用。本版用專案紀錄承接反饋；未測的上游生圖、TTS、HyperFrames 與特殊轉換先驗證再引用。上游 MIT 文本見 [LICENSE.upstream](../LICENSE.upstream)。
