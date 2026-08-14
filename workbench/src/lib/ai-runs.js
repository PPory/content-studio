// 「理解」栏的状态：**同一段话上的多次追问是攒起来的，不是互相覆盖的。**
//
// 上一版是一个 `{ mode, text }`，点「解释」看完再点「展开」，解释就没了。而这三个动作
// 本来就是连着用的——先看它讲什么，再看它往下推，再看反面怎么说，**三段要能对着看**。
// 覆盖掉等于逼你截图或者反复重跑（每跑一次还要再花一次 token）。
//
// 形状：`{ quote, running, error, results: [{ mode, text }] }`
//   - 换一段原文（quote 变了）→ 清空重来。那已经是另一个问题了，攒在一起只会串台。
//   - 同一段、同一个模式再跑一次 → 替换那一条，不叠第二份。
//
// 两个页面（Shelf / Studio）各有一套 runAi，但这套规则只写一份——分头写的话迟早
// 一边攒一边覆盖。

/** 开一次新的追问。返回新的 ai 状态。 */
export function startRun(prev, mode, quote) {
  const kept = prev && prev.quote === quote ? prev.results.filter((r) => r.mode !== mode) : [];
  return { quote, mode, running: true, error: null, results: [...kept, { mode, text: "" }] };
}

/** 改最后一条结果（流式过程中每来一块就调一次）。 */
export function patchRun(prev, patch) {
  if (!prev || !prev.results.length) return prev;
  const results = prev.results.slice();
  results[results.length - 1] = { ...results[results.length - 1], ...patch };
  return { ...prev, results };
}

/** 跑完 / 出错 / 被中止：收掉 running，顺手把最后一条的文字补齐。 */
export function endRun(prev, { text, error } = {}) {
  if (!prev) return prev;
  const next = text === undefined ? prev : patchRun(prev, { text });
  return { ...next, running: false, error: error || null };
}
