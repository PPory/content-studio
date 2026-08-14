// 飞书卡片构造。
//
// 卡片是这次换飞书真正拿到的东西——Telegram 那边给不了。它解决的不是「少打几个字」，
// 而是把拍板选题从**两个有顺序要求的动作**压成一次点击：
//
//   原来：先勾「适配平台」，再改状态成「撰写中」，且顺序不能反
//   现在：点「公众号」，平台和触发是同一个动作
//
// 按钮的 `value` 会被飞书原样回传到回调的 `event.action.value`，所以那里塞的就是
// 成稿需要的全部参数。**不要往 value 里塞大对象**：卡片整体上限 30KB，而且它会
// 在每次点击时回传一遍。

import { PLATFORMS } from "./values.js";

/** 卡片上最多摆几个平台按钮。五个平台全摆出来在手机上会挤成两行还看不清主次。 */
const QUICK_PLATFORMS = ["公众号", "X"];

function platformButtons(topic) {
  // 顺序：LLM 建议的平台排第一并高亮，后面跟上最常用的两个（去重）。
  // 想写别的平台仍然可以用 `/成稿 <关键词> <平台>`，不必为了完备把五个都摆上来。
  const ordered = [];
  if (PLATFORMS.has(topic.platform)) ordered.push(topic.platform);
  for (const p of QUICK_PLATFORMS) if (!ordered.includes(p)) ordered.push(p);

  return ordered.slice(0, 3).map((platform, i) => ({
    tag: "button",
    text: { tag: "plain_text", content: platform },
    type: i === 0 ? "primary" : "default",
    value: { action: "draft", topicId: topic.id, platform },
  }));
}

function topicBlock(topic, index) {
  const lines = [`**${index}. ${topic.title}**`];
  if (topic.viewpoint) lines.push(topic.viewpoint.slice(0, 160));
  if (topic.audience) lines.push(`*读者：${topic.audience.slice(0, 60)}*`);
  return [
    { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
    { tag: "action", actions: platformButtons(topic) },
  ];
}

/**
 * 每日整理产出的选题卡片。
 *
 * 点按钮＝直接开写，所以卡片上只放**决定要不要写**需要的信息：标题、核心观点、
 * 目标读者。写作要点那些等真正开写时在稿子里看，堆到卡片上只会让人不想读。
 */
export function topicsCard(topics, { title = "今天聚出这些选题" } = {}) {
  const elements = [];
  topics.forEach((t, i) => {
    if (i > 0) elements.push({ tag: "hr" });
    elements.push(...topicBlock(t, i + 1));
  });
  elements.push({
    tag: "note",
    elements: [{
      tag: "plain_text",
      content: "点平台按钮＝写那一篇（几分钟后回你）。想写别的平台用 /成稿 <关键词> <平台>",
    }],
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `📌 ${title}（${topics.length}）` },
      template: "blue",
    },
    elements,
  };
}
