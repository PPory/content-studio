// 成稿平台的**唯一一份前端清单**。
//
// ⚠️ **必须和 `worker/src/lib/values.js` 的 `PLATFORMS` 逐字一致。**
// 对不上的后果不报错：Worker 会把认不出的平台 filter 掉然后静默不写那一个，
// 界面上看不出任何异常，只是稿子永远不来。
//
// 这份原来在 `sources.js` 和 `CreationDialog.jsx` 里各有一份（逐字相同的两行数组），
// 收成一处是因为现在第三处也要用它（`NewContentButton` 的「空白文章 · 发哪儿」）。

export const PLATFORMS = ["公众号", "X", "小红书", "视频号", "YouTube"];
