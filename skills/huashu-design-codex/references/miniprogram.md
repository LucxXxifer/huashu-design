# 微信小程序原型與工程交接

先定主要入口。群聊卡片要直達分享的內容，現場掃碼要能單手完成主操作，回訪要能快速找回上次的事。朋友圈的單頁必須能獨立理解。方向卡另寫入口、首屏和 5:4 分享圖。延續六卡三稿的選擇流程。每個方向以一張可操作的展示板呈現 4–5 屏與聊天分享卡，區分入口、首屏形態、簽名處、色彩理由或導覽結構。選稿後再畫關鍵的載入、空白、錯誤、未登入與完成狀態。

原型以 375 CSS px 做設計（1 CSS px = 2 rpx），驗收輸出寬度 750 px。小程序膠囊和狀態列的位置由微信決定，別在旁邊放文字或可點的元件。`nav="custom"` 需自行處理頂部 84 px 的構圖，工程用 `wx.getMenuButtonBoundingClientRect` 讀真機規格。互動目標約 44 px，正文以 12 px 為最低檢查基準。微信上線規格以 [小程序開放文件](https://developers.weixin.qq.com/miniprogram/dev/framework/) 和目標裝置為準。

## 做出可點的展示板

依 [固定上游 React 規範](https://github.com/alchaincyf/huashu-design/blob/937113133ae446a69ea19d4ceed6cbd2ed3c7735/references/react-setup.md) 的版本與完整性資料載入 React、React DOM 18.3.1 和 Babel 7.29.0。複製本 Skill 的 `assets/wechat_frame.jsx` 和 `assets/showboard.jsx` 到專案，接在 React 標籤後用 `<script type="text/babel" src="wechat_frame.jsx"></script>` 等載入，最後載入原型自己的 JSX。驗收在本機替換固定 React 並預先編譯 JSX。

```jsx
<Showboard layout="hero" title="小滿咖啡" screens={[
  {label:'點單', main:true, node:<WechatFrame page="pages/menu/menu" title="點單" home footer={<OrderAction/>}><Menu/></WechatFrame>},
  {label:'確認', via:'選擇餐點', node:<WechatFrame page="pages/confirm/confirm" title="確認" back onBack={returnToMenu}><Confirm/></WechatFrame>},
]} aside={<WechatShareCard appName="小滿咖啡" title="今日菜單"><img src="menu.jpg" alt="今日餐點"/></WechatShareCard>}/>
```

選 `hero` 主次、`flow` 流程、`closeup` 特寫，依方向調構圖。主要屏較大，其餘錯落，分享卡放在聊天語境中。裝置框提供狀態列、膠囊與指示條。用 `footer` 放固定結算條，原生 tab 頁傳同一套 `tabBar.list` 和各頁的 `tab`，以 `onTabChange` 接原型狀態。二級頁傳 `back` 和 `onBack`。自訂 tabBar 用 `data-mp-tabbar="custom"` 標示並留 34 px 底部安全區。全案擇一模式、2–5 個 tab（建議最多 4 個）。同一頁的不同設計狀態用相同 `page`、不同畫面。長內容放在內建滾動區。

小程序工程用 `<image>` 承載本地圖，個別大圖先壓縮。自訂字型需核對授權及 `wx.loadFontFace` 所需的實際字元。檢查無毛玻璃的 Android fallback、地圖／影片等原生元件上方是否仍可交互。將登入和訂閱放在需要時，預先設計拒絕之後的畫面。

## 匯出與驗收

從 [本機驗收工具](runtime.md#mini) 跑 `mini`。打開 `screens/` 的逐屏與長圖、每張 `share-*.png`，看原尺寸裁切和文字是否正確。`app.json` 是路徑、視窗與 tab 的起點。混合 `nav` 的頁面需補各頁 JSON。再補 tab 圖示、實際分享路徑、資料來源與原生實作。`tokens.json` 是設計取樣，`images/` 為已匯出的素材。若圖或互動仍缺，保留原型和 `result.json` 並修完再交。

`設計稿.html` 保留原稿。用 [offline](runtime.md#offline) 另外生成可斷網重開的 `.offline.html`，有依賴原始工作目錄的原型在交出去前應附離線版本與已驗操作。上游以圖片用量接近 1.5 MiB 為提醒，主包實際大小須在微信開發工具核對。

## 交給 WorkBuddy 或工程師

定稿後可將交接資料夾交給 WorkBuddy 的「小程序」開發入口，並附 `給WorkBuddy的話.md`，說清楚資料存本機還是雲端。原型中的畫面、尺寸、設計資產與交互需逐屏對照實作。記錄完成階段為設計稿、交接、原生工程、微信預覽或真機驗收。需要發布時由有權限的使用者在微信完成授權。
