/**
 * 你正在形成的样子。
 *
 * ⚠️ **这不是一张要填的表，也不是一个新页面。**
 * 定位是长期反复解决某类问题之后别人对你形成的判断，所以它只能被**观察**出来——
 * 全部数字都从议程 → 内容机会 → 项目 → 发布 → 实验这条已有的链上算，
 * 没有任何一个字段需要用户录入。它长在复盘页，因为复盘回答的就是「发出去之后我学到了什么」。
 *
 * ⚠️ **数据不够时说不知道，并且说清还差几条。**
 * 一篇已发布算不出「你总在解决什么」。这时候画一个看起来很满的仪表盘就是编，
 * 而一句没有数字的「继续加油」同样没用——你读完并不知道什么时候能看到结果。
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import "./positioning-note.css";

const VERDICT_LABELS = { supported: "成立", mixed: "一半一半", refuted: "不成立" };

export function PositioningNote() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.positioning()
      .then((result) => alive && setData(result.positioning))
      // 读不出来不该让整页失败：复盘本身和这块观察无关。
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  if (failed || !data) return null;

  const { counts, missing, problems, agendas, claims, learnings, verdicts } = data;
  const nothingYet = !counts.publications && !counts.opportunities;
  if (nothingYet) return null;

  return (
    <section className="positioning" aria-labelledby="positioning-title">
      <header>
        <h2 id="positioning-title">你正在形成的样子</h2>
        <small>不是填出来的，是从你已经做过的事里看出来的</small>
      </header>

      {!data.ready ? (
        <p className="positioning__pending">
          还看不出来——{missing.join("、")}就能开始说了。
          <span>已经积累：{counts.publications} 篇已发布 · {counts.settledExperiments} 次实验结算 · {counts.opportunities} 条内容机会 · {counts.problems} 个用户问题</span>
        </p>
      ) : null}

      <div className="positioning__grid">
        {problems.length ? (
          <div>
            <h3>你反复回答的问题</h3>
            <ul>
              {problems.map((item) => (
                <li key={item.statement}>
                  <strong>{item.statement}</strong>
                  <small>{item.projects} 篇写过 · {item.opportunities} 条机会{item.origin === "hypothesis" ? " · 待验证" : ""}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {claims.length ? (
          <div>
            <h3>你已经留在外面的判断</h3>
            <ul>
              {claims.map((item) => (
                <li key={item.claim}>
                  <strong>{item.claim}</strong>
                  <small>{item.agendaTitle || "暂未关联议程"}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {agendas.length ? (
          <div>
            <h3>议程兑现到哪一步</h3>
            <ul>
              {agendas.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  {/* 说了什么不重要，有没有真的发出去才重要 */}
                  <small>{item.opportunities} 条机会 · {item.projects} 篇在做 · {item.publications} 篇已发布</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {learnings.length ? (
          <div>
            <h3>你从现实里更新过的判断</h3>
            <ul>
              {learnings.map((item) => (
                <li key={item.settledAt}>
                  <strong>{item.learning}</strong>
                  <small>{VERDICT_LABELS[item.verdict] || item.verdict} · 原假设：{item.hypothesis}</small>
                </li>
              ))}
            </ul>
            {Object.keys(verdicts).length ? (
              <p className="positioning__verdicts">
                {Object.entries(verdicts).map(([key, value]) => `${VERDICT_LABELS[key] || key} ${value}`).join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
