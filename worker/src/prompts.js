// 提示词从 prompt/*.md 文件加载（wrangler Text 模块，部署时打包进 Worker）。
// 想改提示词就直接编辑 prompt/ 下的 .md，然后 npx wrangler deploy 即可生效——不用动代码。
//
// 文件分工：
//   triage.md            任务1 初筛
//   synthesize.md        任务2 每日整理
//   draft.md             任务3 成稿骨架（含 {{voice}} {{frameworks}} {{platform_guide}} 占位）
//   voice.md             作者声音/人设（被 draft/tweet 复用）
//   frameworks.md        可选结构框架（被 draft 复用）
//   platform/*.md        每个平台的专属创作指南，成稿时按平台注入 {{platform_guide}}
// 三段主 prompt（triage/synthesize/draft）与 Notion《外部自动化技术方案》第七节保持一致。

import TRIAGE_MD from "../prompt/triage.md";
import SYNTHESIZE_MD from "../prompt/synthesize.md";
import DRAFT_MD from "../prompt/draft.md";
import TWEET_MD from "../prompt/tweet.md";
import VOICE_MD from "../prompt/voice.md";
import FRAMEWORKS_MD from "../prompt/frameworks.md";
import TAGS_MD from "../prompt/tags.md";
import EXPLAIN_MD from "../prompt/explain.md";
import PICK_MATERIALS_MD from "../prompt/pick-materials.md";
import IDEAS_ANGLES_MD from "../prompt/ideas-angles.md";
import IDEAS_MATERIALS_MD from "../prompt/ideas-materials.md";
import IDEAS_CARD_MD from "../prompt/ideas-card.md";
import MATERIAL_DRAFT_MD from "../prompt/material-draft.md";
import COLLECTION_ORGANIZE_MD from "../prompt/collection-organize.md";
import KNOWLEDGE_CARD_MD from "../prompt/knowledge-card.md";
import WRITING_ASSIST_MD from "../prompt/writing-assist.md";
import TEXT_REVISION_MD from "../prompt/text-revision.md";

import GUIDE_GZH from "../prompt/platform/gongzhonghao.md";
import GUIDE_X from "../prompt/platform/x.md";
import GUIDE_XHS from "../prompt/platform/xiaohongshu.md";
import GUIDE_SPH from "../prompt/platform/shipinhao.md";
import GUIDE_YT from "../prompt/platform/youtube.md";

// 平台展示名 → 专属创作指南
const PLATFORM_GUIDES = {
  公众号: GUIDE_GZH,
  X: GUIDE_X,
  小红书: GUIDE_XHS,
  视频号: GUIDE_SPH,
  YouTube: GUIDE_YT,
};

// 标签词表（单一真源 prompt/tags.md）：一行一个标签，供初筛 / 整理 / Bot 存素材统一取用，
// 避免标签碎片化。改词表只需编辑 tags.md 再 deploy。
export const TAG_VOCAB = TAGS_MD.split("\n").map((s) => s.trim()).filter(Boolean);

// 把 {{voice}} / {{frameworks}} / {{platform_guide}} / {{tags}} 占位替换成对应内容
function compose(template, { guide = "" } = {}) {
  return template
    .replaceAll("{{voice}}", VOICE_MD.trim())
    .replaceAll("{{frameworks}}", FRAMEWORKS_MD.trim())
    .replaceAll("{{platform_guide}}", guide.trim())
    .replaceAll("{{tags}}", TAG_VOCAB.join("、"))
    .trim();
}

// 成稿：按目标平台注入该平台的专属创作指南
export function draftPrompt(platform) {
  return compose(DRAFT_MD, { guide: PLATFORM_GUIDES[platform] || "" });
}

// Telegram /推：从 X 帖 / 文章 / 想法快速出推文候选，固定注入 X 平台指南
export function tweetPrompt() {
  return compose(TWEET_MD, { guide: GUIDE_X });
}

export const TRIAGE_PROMPT = compose(TRIAGE_MD);
export const SYNTHESIZE_PROMPT = compose(SYNTHESIZE_MD);
// creator-workbench 阅读区的划词 AI（解释/展开/反驳/选题），通过真实性校验后返回、默认不落库
export const EXPLAIN_PROMPT = compose(EXPLAIN_MD);
// creator-workbench 创作弹层「按意思找素材」：关键词搜不到时，让模型在整库候选里挑
export const PICK_MATERIALS_PROMPT = compose(PICK_MATERIALS_MD);
/**
 * 「找题」那一屏的两条。**两个都只读，不往库里写一行。**
 *
 * `ideas-angles`：从一件事里拆出**争点**——和反应清单不是一件事。
 *   反应清单问「你什么反应」，争点问「这件事的分歧在哪」；
 *   后者是在你**还没有反应**的时候，帮你找到可以有反应的地方。
 * `ideas-materials`：把一段时间的素材聚成几个角度。
 *   ⚠️ 和任务2（`synthesize.md`）分开：那条定时任务**写 topics 表**，
 *   这条只回候选给你看——写库会触发已有流转，而 topics 已经是作废的一层。
 */
export const IDEAS_ANGLES_PROMPT = compose(IDEAS_ANGLES_MD);
export const IDEAS_MATERIALS_PROMPT = compose(IDEAS_MATERIALS_MD);
/**
 * 出卡：**三条来源共用这一份**。
 * ⚠️ 它要同时看得到「角度」和「素材库」——所以出卡只能在 Worker，
 * 洞察那条 skill 跑在本机 vault 上，够不着素材库，**给不出最值钱的那一项**。
 */
export const IDEAS_CARD_PROMPT = compose(IDEAS_CARD_MD);
// creator-workbench 创作弹层「让 AI 生成初稿」：用户挑好的素材 + 简报 → 一份可编辑初稿。
// 和任务3 的成稿（`draft.md`）分开：那边是流水线按选题自动跑，这边是人挑好素材当场要一版
export const MATERIAL_DRAFT_PROMPT = compose(MATERIAL_DRAFT_MD);
export const COLLECTION_ORGANIZE_PROMPT = compose(COLLECTION_ORGANIZE_MD);
export const KNOWLEDGE_CARD_PROMPT = compose(KNOWLEDGE_CARD_MD);
// 创作编辑器里的即时推动：默认只问一个问题；用户明确选择后才续写。
export const WRITING_ASSIST_PROMPT = compose(WRITING_ASSIST_MD);
// 创作编辑器的选区润色/纠错/缩写/扩写/改写；只返回替换文本。
export const TEXT_REVISION_PROMPT = compose(TEXT_REVISION_MD);

// Telegram 长文本提炼标题（入口用的轻量 prompt，非三段主 prompt，留在代码里）
export const TITLE_PROMPT = `你是标题提炼助手。用户会给你一段较长的中文或英文文本，请提炼一个不超过 30 字的标题，概括其核心内容。只输出 JSON：{"title": "..."}，不要任何多余文字。`;

// Bot 存素材·异步补标签：已知类型和内容，只补标签。异步跑、不阻塞入库。
export const TAG_PROMPT = `你是素材打标签助手。根据给定的素材内容和类型，给它打 1-4 个检索用标签。
标签词表（优先从中选）：${TAG_VOCAB.join("、")}
规则：能用词表里的就用词表里的；词表里没有贴切的才新增，新增前先想有没有近义已有标签能复用，避免碎片化（例如别让「AI」「人工智能」「AI工具」并存）。
只输出 JSON：{"tags": ["...", "..."]}，不要任何多余文字。`;

// Bot /素材：随手粘的内容，自动判类型、起标题、打标签。
export const CLASSIFY_PROMPT = `你是素材归类助手。用户随手粘来一段内容，请判断它属于哪种素材类型、起一个简短标题、并打 1-4 个标签。
type 取以下之一：核心观点 / 金句·原话 / 数据·事实 / 案例·故事 / 框架·模型 / 反直觉点 / 个人经历。
只有用户明确讲述自己的真实经历时才能判为「个人经历」；不得把案例或他人的故事改成用户亲历。
凡判为「金句·原话」或「数据·事实」的，视为逐字保真素材，标题只做概括、正文由程序原样保存，你不要改写正文。
标签规则：优先从词表选——${TAG_VOCAB.join("、")}——词表没有贴切的才新增，尽量复用近义已有标签，避免碎片化。
只输出 JSON：{"type": "...", "title": "...", "tags": ["...", "..."]}，不要任何多余文字。`;
