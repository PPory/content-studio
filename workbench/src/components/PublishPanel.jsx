import { useState } from "react";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";

const METRICS = [
  ["views", "阅读 / 播放"],
  ["likes", "点赞"],
  ["comments", "评论"],
  ["collects", "收藏"],
  ["shares", "分享"],
];

function localNow() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function PublishPanel({ item, doc, onPublished }) {
  const raw = item.raw || {};
  const [form, setForm] = useState({
    url: raw.publishedUrl || "",
    publishedAt: raw.publishedAt ? raw.publishedAt.slice(0, 16) : localNow(),
    views: raw.views ?? "",
    likes: raw.likes ?? "",
    comments: raw.comments ?? "",
    collects: raw.collects ?? "",
    shares: raw.shares ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.publishDraft({
        draftId: item.key,
        title: doc?.title || item.title,
        platform: raw.platform,
        ...form,
      });
      setResult(response);
      onPublished?.(response, form);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="publish-panel">
      <div className="publish-panel__head">
        <div>
          <span className="eyebrow">PUBLISH & LEARN</span>
          <h3>{raw.status === "已发布" ? "更新发布表现" : "记录发布"}</h3>
        </div>
        <p>链接和时间必填；表现数据可现在填，也可之后回来补。</p>
      </div>
      <form onSubmit={submit}>
        <label className="field publish-panel__url">
          <span>发布链接</span>
          <input type="url" value={form.url} onChange={set("url")} placeholder="https://…" required />
        </label>
        <label className="field">
          <span>发布时间</span>
          <input type="datetime-local" value={form.publishedAt} onChange={set("publishedAt")} required />
        </label>
        <div className="publish-panel__metrics">
          {METRICS.map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input type="number" min="0" inputMode="numeric" value={form[key]} onChange={set(key)} placeholder="选填" />
            </label>
          ))}
        </div>
        <ErrorNote error={error} what="记录发布" />
        {result ? (
          <Note tone={result.performance?.status === "表现突出" ? "success" : "default"} title={result.performance?.status || "已记录"}>
            {result.performance?.summary}{result.feedbackCreated ? ` 已自动沉淀 ${result.feedbackCreated} 条有效素材。` : ""}
          </Note>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !form.url || !form.publishedAt}>
          {busy ? "记录中…" : raw.status === "已发布" ? "更新数据并复盘" : "确认已发布"}
        </button>
      </form>
    </section>
  );
}
