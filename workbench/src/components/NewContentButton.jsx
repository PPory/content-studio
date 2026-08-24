// 全工作台共用的一颗「新建内容」。点击后直接进入项目编辑器，不再先问起稿方式。
// 素材和梳理想法都在项目里随写随用；固定读者、常用平台来自「我的创作」。

import { useState } from "react";
import { api } from "../lib/api.js";
import { startWriting } from "../lib/start-writing.js";
import { markTemporaryProject } from "../lib/temporary-project.js";
import { IconLoader2, IconPlus } from "./icons.jsx";

export function NewContentButton({ onGo, onChanged, label = "新建内容", className }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // 配置读不到时也不设收费站：用安全默认值照样开稿，设置可以之后补。
      const profile = await api.writingProfile().then((value) => value.profile).catch(() => ({ platform: "公众号", audience: "" }));
      const projectId = await startWriting({
        platform: profile.platform || "公众号",
        audience: profile.audience || "",
      });
      // 只有这颗“直接新建空内容”的入口是临时项目；从种子、素材或已有项目进入都不是。
      markTemporaryProject(projectId);
      onChanged?.();
      onGo("project", projectId);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="new-content-action">
      <button type="button" className={className || "btn btn-primary"} onClick={create} disabled={busy} aria-busy={busy}>
        {busy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconPlus aria-hidden="true" />}{label}
      </button>
      {error ? <span className="note-danger note-danger--inline">{error.message || "建不起来"}</span> : null}
    </span>
  );
}
