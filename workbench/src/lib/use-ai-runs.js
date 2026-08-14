// 划词 AI 的那一套（解释 / 展开 / 反驳 / 翻译）收成一个 hook。
//
// 三个地方要用它：书架、内容工作台、热点原文。前两处原来各写了一份一模一样的
// `runAi` + `translate`——第三处再抄一遍就是三份，而这段逻辑里有两个容易写错的点
// （攒结果不覆盖、中止时不要把错误当失败报出去），抄错一处不会报错，只会安静地少个行为。
//
// 状态的形状和迁移规则在 `ai-runs.js`（纯函数，好测）；这里只管请求、中止和生命周期。

import { useCallback, useEffect, useRef, useState } from "react";
import { api, explainStream } from "./api.js";
import { startRun, patchRun, endRun } from "./ai-runs.js";

export function useAiRuns({ title = "", onStart } = {}) {
  const [ai, setAi] = useState(null);
  const abortRef = useRef(null);

  // 组件卸下时把在飞的请求掐掉，别让它在后台继续烧 token
  useEffect(() => () => abortRef.current?.abort(), []);

  const runAi = useCallback(
    (mode, text, context = "") => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      onStart?.(text);
      // 攒起来，不覆盖：解释看完再点展开，两段要能对着看（见 lib/ai-runs.js）
      setAi((prev) => startRun(prev, mode, text));
      explainStream({
        signal: ac.signal,
        mode,
        selection: text,
        context,
        title,
        onChunk: (full) => setAi((a) => (a && a.running ? patchRun(a, { text: full }) : a)),
      })
        .then((full) => setAi((a) => endRun(a, { text: full })))
        .catch((e) => {
          // 中止不是失败：用户自己点的停止 / 关掉了面板，不该弹一条红色错误
          if (e.name === "AbortError") return setAi((a) => endRun(a));
          setAi((a) => endRun(a, { error: e }));
        });
    },
    [title, onStart]
  );

  const translate = useCallback(
    async (text) => {
      onStart?.(text);
      setAi((prev) => startRun(prev, "翻译", text));
      try {
        const r = await api.translate(text);
        setAi((a) => endRun(a, { text: r.text }));
      } catch (e) {
        setAi((a) => endRun(a, { error: e }));
      }
    },
    [onStart]
  );

  const stopAi = useCallback(() => abortRef.current?.abort(), []);
  const resetAi = useCallback(() => {
    abortRef.current?.abort();
    setAi(null);
  }, []);

  return { ai, runAi, translate, stopAi, resetAi };
}
