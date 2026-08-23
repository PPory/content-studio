// 「新建内容」那颗按钮 —— **四个页面共用一颗**。
//
// ⚠️ **收成一个组件是因为四处原来各拼一遍同一份菜单。**
// 今日 / 内容 / 素材工作台 / 旧总览里都写着
// `MODES.map(...)` + 一模一样的 `onCreated` 跳转，四份逐行只差一个 toast。
// 加一条起点、或者像这次一样改一条起点的走法，要改四处——而漏掉一处不报错，
// 表现是「从首页新建和从内容页新建行为不一样」。
//
// ⚠️ **写作只在 `#/project/:id`。** 这颗按钮的三条起点最后都落在那儿：
// 空白直接建项目跳过去，素材和访谈在弹层里**准备**完再建项目跳过去。
// 弹层里没有编辑器。

import { useState } from "react";
import { MenuButton, valueIcon } from "./ui.jsx";
import { CreationDialog, MODES } from "./CreationDialog.jsx";
import { PLATFORMS } from "../lib/platforms.js";
import { startWriting } from "../lib/start-writing.js";
import { IconPlus, IconWorld } from "./icons.jsx";

export function NewContentButton({ onGo, onChanged, onToast, label = "新建内容", className }) {
  // 弹层只在「从素材开始 / 访谈起稿 / 新建选题」时开——空白那条根本不开
  const [creation, setCreation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // `startWriting` 拿不到项目地址时会抛，所以这儿不用再判空——**判空等于把「点了没反应」当成正常路径**
  const land = (projectId) => {
    onChanged?.();
    onGo("project", projectId);
  };

  async function blankOn(platform) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      land(await startWriting({ platform, mode: "blank" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const prep = MODES.filter((m) => m.key !== "blank");

  return (
    <>
      <MenuButton
        label={label}
        icon={IconPlus}
        busy={busy}
        className={className}
        ariaLabel="新建内容"
        items={[
          /**
           * ⚠️ **空白文章展开成平台，不是一颗按钮。**
           * 主稿的平台建完就改不了（Worker 的 `EDITABLE.drafts` 里没有 `platform`，
           * 只能再加平台**变体**），所以必须在点下去之前问清楚。
           * 默认一个「大概是公众号吧」的代价是：你写完才发现，只能重开一篇。
           */
          ...PLATFORMS.map((name, i) => ({
            key: `blank:${name}`,
            section: i === 0 ? "空白文章 · 发哪儿" : undefined,
            // 平台名是自解释的，所以**不给 hint**——「每条带一句说明」那条规矩
            // 是给三条起点的（「从素材开始」和「访谈起稿」的差别全在那句话上）。
            icon: valueIcon(name, IconWorld),
            title: name,
            onPick: () => blankOn(name),
          })),
          ...prep.map((m, i) => ({
            key: m.key,
            section: i === 0 ? "先准备再写" : undefined,
            icon: m.icon,
            title: m.title,
            hint: m.hint,
            onPick: () => setCreation(m.key),
          })),
        ]}
      />

      {/* 建项目失败要说出来：这颗按钮点完是**跳走**，静默失败看着就是「点了没反应」 */}
      {error ? <p className="note-danger note-danger--inline">{error.message || "建不起来"}</p> : null}

      <CreationDialog
        open={!!creation}
        preset={creation}
        onClose={() => setCreation(null)}
        onStarted={(projectId) => land(projectId)}
        onTopicCreated={(topic, project) => {
          onChanged?.();
          onToast?.(`选题《${topic.title}》已建立`);
          onGo("project", project?.id || topic.id);
        }}
      />
    </>
  );
}
