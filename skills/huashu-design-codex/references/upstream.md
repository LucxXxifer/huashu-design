# 上游素材與深讀索引

使用 [alchaincyf/huashu-design v3.5.0](https://github.com/alchaincyf/huashu-design/tree/937113133ae446a69ea19d4ceed6cbd2ed3c7735) 的固定快照。此標籤的 `SKILL.md` 及 `package.json` 皆為 3.5.0。上游共用同一份 Skill，Claude Code、Codex 和 WorkBuddy 依宿主可用工具執行。這份索引只需選讀當次媒介。

可在固定 GitHub URL 讀單檔，或用手邊已驗證的固定快照供選讀。若需要大量樣張或元件，另備該固定 commit 的唯讀副本並核對來源；不寫到已安裝 Skill，也不執行其中的安裝或巢狀 CLI。缺原始參照時要用實際同媒介替代品或記錄缺口，不能把檔名當已看過的圖片。

| 任務 | 先查 | 再查／素材入口 |
|---|---|---|
| 方向與素材 | `references/directions.md`、`design-context.md`、`workflow.md`、`brand-asset-protocol.md` | `materials.md`、`design-styles.md`、`typography.md`、`assets/style-specimens/`（92 個風格 + 8 個 App 範式 HTML）、`assets/showcases/INDEX.md` |
| 真實 Web、介面與調參 | `references/modules/web.md`、`references/tweaks-system.md` | `react-setup.md`、`assets/design_canvas.jsx`、`browser_window.jsx`、`macos_window.jsx`；Tweaks 由同一份 state 驅動 |
| 簡報 | `references/modules/deck.md`、`references/slide-decks.md` | `editable-pptx.md`、`pptx-from-rendered-html.md`、`assets/deck_stage.js`、`deck_index.html`；優先遵守本版輸出定義 |
| 資訊圖、App、商店圖 | `references/modules/infographic.md`、`references/app-prototype.md`、`references/app-paradigms.md`、`references/modules/appstore.md` | `apple-gallery-showcase.md`、`assets/ios_frame.jsx`、`android_frame.jsx`、`appstore/template.html` |
| 微信小程序 | `references/modules/miniprogram.md`、`references/app-prototype.md` | 本版 [小程序交接](miniprogram.md)，對照 `assets/wechat_frame.jsx`、`assets/showboard.jsx` |
| 小紅書 | `references/modules/xiaohongshu.md` | `assets/style-specimens/xhs/_kit/`；其中 `stickers/LICENSE.md` 是獨立的 PolyForm Shield，不按主 repo MIT 散佈 |
| 動態 | `references/modules/motion.md`、`references/storyboard-basics.md`、`references/video-export.md` | `animations.md`、`animation-pitfalls.md`、`camera-language.md`、`ui-demo-animation.md`、`launch-film-director-notes.md`、`assets/animations.jsx`、`cursor.jsx` |
| 旁白與音響 | `references/voiceover-pipeline.md`、`references/audio-design-rules.md`、`references/sfx-library.md` | `assets/narration_stage.jsx`、`assets/sfx/`、`assets/bgm-*.mp3`；例子引用但未附的旁白不能視為已生成；核對實際資產權利 |
| 進階動態與評審 | `references/hyperframes-backend.md`、`references/gsap-recipes.md`、`references/ai-video-review.md` | `references/polish-loop.md`、`critique-guide.md`、`verification.md`；驗收通過仍開圖、看片 |

變更對照：保留六卡三稿、選擇權、多輪打磨、素材與媒介知識；將 Claude 工具名稱換為宿主已暴露的工具及本機驗收；保留原來的導演和取材配方作為選讀。`about-author.md`、作者水印、私人外觀帳本、`experience.md`／`evolution.md` 的全域記憶與 Claude hook 不會自動啟用。本版用專案紀錄承接反饋；未測的上游生圖、TTS、HyperFrames 與特殊轉換先驗證再引用。上游 MIT 文本見 [LICENSE.upstream](../LICENSE.upstream)。

維護時比較上游標籤、各媒介模組與共用畫面資產。更新此固定索引之後，跑 Codex 的受影響命令和 ZIP 測試，再從對應提交的 Actions 下載。上游的每日版本提醒和 `git pull` 指向共用原版，特化版由 fork 和 Magpie 的來源更新。
