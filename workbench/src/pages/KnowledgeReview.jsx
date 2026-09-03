/**
 * 审阅 AI 想往 Wiki 里写的东西。**一屏只干这一件事。**
 *
 * ⚠️ **它从 Wiki 首页搬出来了，别搬回去。** 那时它是首页顶上的一段列表，
 * 于是两个完全不同的任务挤在同一屏：**查词条**（九成的来访目的，需要一条长索引）
 * 和**审阅**（偶发，需要整页宽度读 diff）。挤在一起的结果是两边都不好用——
 * 有候选时索引被压到折叠线以下，而审阅的 diff 被右栏和索引的栏宽夹着。
 *
 * 现在 Wiki 首页只留一行入口（`.wiki-todo`），点进来是这一屏：满宽、没有右栏、
 * 没有索引。「全库体检」跑完之后也落到这儿。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, PageHeader } from "../components/ui.jsx";
import { IngestReview } from "../components/IngestReview.jsx";
import { IconArrowLeft } from "../components/icons.jsx";
import { ScrollToTop } from "../components/ScrollToTop.jsx";

export function KnowledgeReview({ onGo, focusSourceId = "" }) {
  const [wiki, setWiki] = useState(null);
  const [error, setError] = useState(null);

  /**
   * 只为一件事拉这份数据：**每张 Wiki 页面现在是第几版**。
   * 候选里记着它算出来时看到的版本（`expectedRevision`），两者对不上就是过期，
   * 而过期的候选点「接受」必然被服务端挡下。判据在 `lib/knowledge-candidates.js`。
   */
  const load = useCallback(() => {
    api.wiki().then((data) => { setWiki(data); setError(null); }).catch(setError);
  }, []);
  useEffect(load, [load]);

  const pageRevisions = useMemo(() => {
    if (!wiki) return null;
    return new Map((wiki.pages || []).map((page) => [page.id, page.revision]));
  }, [wiki]);

  return (
    <div className="view-body knowledge-review">
      <PageHeader
        title="待审阅"
        aside={
          <button type="button" className="btn" onClick={() => onGo?.("entries")}>
            <IconArrowLeft aria-hidden="true" stroke={1.8} />回 Wiki
          </button>
        }
      />

      {error ? <ErrorNote error={error} what="读取 Wiki 版本" onRetry={load} /> : null}
      {!wiki && !error ? <Loading rows={4} /> : null}

      {/**
        * ⚠️ **等版本号拿到再画。** 先画一版「所有候选都能接受」、拿到数据后再把按钮变灰，
        * 中间那一瞬正好是用户去点的时候——而这一屏此刻真实的状态是四份候选全部过期。
        * 宁可多等一次本地查询（同机 SQLite，几毫秒），也不要给一个会翻脸的按钮。
        */}
      {wiki ? (
        <IngestReview onDone={load} focusSourceId={focusSourceId} pageRevisions={pageRevisions} />
      ) : null}

      {wiki ? <ReviewEmpty onGo={onGo} /> : null}
      <ScrollToTop label="返回待审阅顶部" />
    </div>
  );
}

/**
 * 空态。⚠️ `IngestReview` 没有候选时自己返回 `null`，所以这一屏会整个空掉——
 * 而用户是**点着「N 份候选等你审阅」进来的**，看到一片白会以为页面坏了。
 * 这里兜住：说清楚已经没有了，并给回去的路。
 */
function ReviewEmpty({ onGo }) {
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    let alive = true;
    api.knowledgeCandidates()
      .then((result) => { if (alive) setEmpty(!(result.candidates || []).length); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!empty) return null;
  return (
    <div className="wiki-search-empty">
      没有等待审阅的候选了。
      <button type="button" className="link-btn" onClick={() => onGo?.("entries")}>回 Wiki 看全部页面</button>
    </div>
  );
}
