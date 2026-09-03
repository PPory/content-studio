/**
 * 去公开讨论里找有没有人在说这件事。
 *
 * ⚠️ **这一屏和「粘一段」是同一件事的两个起点**，所以它们在同一个抽屉里：
 * 手上已经有话就粘，想知道有没有人在说就搜。分成两个入口，等于让用户在
 * 还不知道这两者区别的时候先做一次选择。
 *
 * ⚠️ **每条候选都要能被当场核对。** 一句「AI 找到了 4 条相关讨论」是没法验证的；
 * 摆出逐字原话和链接，用户三秒就能判断这是不是真的。所以引证是这一屏的主体，
 * 不是折叠起来的细节。
 *
 * ⚠️ **中文平台抓不到要如实说。** 知乎 403、小红书登录墙——这些不能悄悄消失，
 * 否则用户会以为「没人在讨论」，而事实是「这条路走不到那儿」。
 */

import { useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconRefresh, IconMessageQuestion } from "./icons.jsx";

/** 例句不是装饰：这一屏的搜索词该长什么样，说不如给。 */
const EXAMPLES = [
  "people struggling to choose which AI tool to learn",
  "am I actually learning when AI writes it for me",
  "why I stopped using AI note taking apps",
];

export function VoiceHarvest({ onStored, initialQuery = "" }) {
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  /** 已经收下的那几条，按 url 记。收下之后按钮要变成「已收下」，不能还能再点。 */
  const [kept, setKept] = useState({});
  const [keeping, setKeeping] = useState("");

  const find = async (term) => {
    const text = String(term ?? query).trim();
    if (!text || busy) return;
    setQuery(text);
    setBusy(true);
    setError(null);
    setResult(null);
    setKept({});
    try {
      setResult(await api.harvestAudienceVoices({ query: text }));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 收下一条。
   *
   * ⚠️ 走的是 `recordAudienceVoice`——和手动粘贴同一道门。抓取本身不构成
   * 「用户认可这是证据」，点这个按钮才是。
   */
  const keep = async (candidate) => {
    if (keeping) return;
    setKeeping(candidate.url);
    setError(null);
    try {
      const stored = await api.recordAudienceVoice({
        kind: candidate.kind,
        body: candidate.body,
        sourceName: candidate.siteName || candidate.title,
        sourceUrl: candidate.url,
        confirmed: true,
      });
      setKept((current) => ({ ...current, [candidate.url]: stored }));
      onStored?.(stored);
    } catch (failure) {
      setError(failure);
    } finally {
      setKeeping("");
    }
  };

  return (
    <div className="harvest">
      <div className="field">
        <label htmlFor="harvest-query">找什么</label>
        <div className="harvest-search">
          <input
            id="harvest-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); find(); } }}
            placeholder="用一句话说你想知道谁在为什么发愁"
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !query.trim()} onClick={() => find()}>
            <IconRefresh aria-hidden="true" className={busy ? "spinning" : ""} />
            {/* 名字不能是切换按钮「去找找有没有人在说」的前缀：
                一屏两颗按钮，一颗的名字包着另一颗，读屏和测试都分不清哪颗是哪颗。 */}
            {busy ? "正在找…" : "开始找"}
          </button>
        </div>
        <div className="field-hint">
          目前只找得到公开讨论（Reddit、HN、X、Quora）。知乎、小红书、微博要登录才看得到，
          那些用浏览器扩展划词记下来。
        </div>
      </div>

      {!result && !busy ? (
        <div className="harvest-examples">
          <span>比如：</span>
          {EXAMPLES.map((item) => (
            <button key={item} type="button" className="chip" onClick={() => find(item)}>{item}</button>
          ))}
        </div>
      ) : null}

      <ErrorNote error={error} what="找真实用户声音" onRetry={() => find()} />

      {busy ? <Note title="正在读那几页">搜到之后要把每一页真的抓下来再逐句核对，通常半分钟左右。</Note> : null}

      {result && !result.candidates.length ? (
        <Note title="这一轮没有找到能用的">{result.nothingFoundReason}</Note>
      ) : null}

      {result?.candidates.map((candidate) => {
        const stored = kept[candidate.url];
        return (
          <article key={candidate.url} className="harvest-card">
            <header>
              <a href={candidate.url} target="_blank" rel="noreferrer">{candidate.title || candidate.url}</a>
              <small>{candidate.siteName} · {candidate.length} 字</small>
            </header>
            <p className="harvest-summary">{candidate.summary}</p>

            {/*
              ⚠️ 引证是这张卡的主体，不是细节。用户要判断的就是「这话是不是真有人说过」，
              而那只能靠把原话摆出来让他自己看。
            */}
            <ul className="harvest-quotes">
              {candidate.quotes.map((quote) => <li key={quote}>{quote}</li>)}
            </ul>

            <footer>
              {candidate.duplicateOf ? (
                <span className="harvest-note">这一页之前已经记过了</span>
              ) : stored ? (
                <span className="harvest-note harvest-note--ok">已收进真实用户声音</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={Boolean(keeping)}
                  onClick={() => keep(candidate)}
                >
                  <IconMessageQuestion aria-hidden="true" stroke={1.7} />
                  {keeping === candidate.url ? "正在收下…" : "收下这一页"}
                </button>
              )}
            </footer>
          </article>
        );
      })}

      {/*
        ⚠️ **丢掉了什么要说出来。** 只显示留下的那几条，用户没法判断这次搜索
        是「网上没人讨论」还是「模型引不出原话」——而这两件事的下一步完全不同。
      */}
      {result?.dropped.length ? (
        <details className="harvest-dropped">
          <summary>另外 {result.dropped.length} 页没有留下</summary>
          <ul>
            {result.dropped.map((item) => (
              <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>：{item.reason}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {result?.walled.length ? (
        <details className="harvest-dropped">
          <summary>{result.walled.length} 条要登录才看得到</summary>
          <ul>
            {result.walled.map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">{item.platform}：{item.title || item.url}</a>
                　用扩展在页面上划中那几条评论，直接记下来
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {result?.failures.length ? (
        <details className="harvest-dropped">
          <summary>{result.failures.length} 页没抓下来</summary>
          <ul>{result.failures.map((item) => <li key={item.url}>{item.url}：{item.reason}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
