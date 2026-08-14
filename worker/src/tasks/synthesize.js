// 任务2 · 每日整理（14:00 北京 / 06:00 UTC）：把「待选题」（高价值·待聚类）的
// 灵感 + 关联素材跨条聚类成选题，写入选题库（状态=待写），用过的灵感改「已选题」。

import { SYNTHESIZE_PROMPT } from "../prompts.js";
import { chatJson } from "../lib/llm.js";
import { assertGroundedGeneratedText, isMaterialEligibleForDraft, primaryPlatform, stableTaskKey } from "../lib/integrity.js";
import {
  listByStatus, materialsOfInbox, upsertByTaskKey, updateStatusMany,
  linkTopicInbox, linkTopicMaterials, tagsOf,
} from "../lib/db.js";
import { INBOX_STATUS, TOPIC_STATUS, PLATFORMS, PRIORITIES } from "../lib/values.js";

const INBOX_BATCH = 20; // 每天最多带入聚类的灵感条数
const TOPICS_CAP = 5;   // 每天最多产出选题数

export async function runSynthesize(env) {
  // 只读「待选题」——初筛已按价值分流，待选题即高价值·待聚类，无需再叠加价值判断过滤。
  const inspirations = await listByStatus(env, "inbox", INBOX_STATUS.TO_CLUSTER, INBOX_BATCH);
  if (!inspirations.length) {
    console.log("synthesize: nothing to cluster");
    return { topics: 0, marked: 0, empty: true };
  }

  const inspirationIds = inspirations.map((p) => p.id);
  // 原来是「把所有有来源的素材整库拉回来，再在内存里按 relation 过滤」。
  // 现在直接 WHERE inbox_id IN (…)，库涨到几万条也只回这一批。
  const allMaterials = await materialsOfInbox(env, inspirationIds);
  const materials = allMaterials.filter((m) =>
    isMaterialEligibleForDraft({ type: m.type, verificationStatus: m.verification })
  );

  const inboxTags = await tagsOf(env, "inbox", inspirationIds);
  const input = {
    inspirations: inspirations.map((p) => ({
      id: p.id,
      title: p.title,
      one_line: p.verdict,
      tags: inboxTags.get(p.id) || [],
      link: p.link,
    })),
    materials: materials.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      note: m.content,
      verification_status: m.verification,
      source_inspiration_ids: m.inbox_id ? [m.inbox_id] : [],
    })),
  };

  const { json } = await chatJson(env, {
    system: SYNTHESIZE_PROMPT,
    user: JSON.stringify(input),
    maxTokens: 12000,
  });

  const topics = (json.topics || []).slice(0, TOPICS_CAP);
  const personalEvidence = input.materials
    .filter((material) => material.type === "个人经历" && material.note)
    .map((material) => ({ type: "个人经历", note: material.note }));
  assertGroundedGeneratedText(topics, personalEvidence);

  const knownInbox = new Set(inspirationIds);
  const materialIds = new Set(materials.map((m) => m.id));
  const linkedInspirations = new Set();
  const createdTopics = [];   // 卡片要用：渲染按钮需要 id/标题/观点/建议平台
  let createdCount = 0;
  let topicCount = 0;

  for (const t of topics) {
    if (!t?.topic) continue;
    const sourceIds = [...new Set((t.source_inspiration_ids || []).filter((id) => knownInbox.has(id)))];
    const linkedMaterialIds = [...new Set((t.material_ids || []).filter((id) => materialIds.has(id)))];
    // 没有可追溯灵感的“选题”不能落库，防止模型凭空造题后把整批灵感标完成。
    if (!sourceIds.length) continue;

    // 平台收敛成单值：draft.js 本来就只写主平台，选题库存一个多选纯属误导。
    const platform = primaryPlatform((t.platforms || []).filter((p) => PLATFORMS.has(p)));
    const taskKey = stableTaskKey(
      "synthesize-topic",
      [...sourceIds].sort(),
      [...linkedMaterialIds].sort()
    );
    const upserted = await upsertByTaskKey(env, "topics", taskKey, {
      title: t.topic.slice(0, 200),
      viewpoint: t.viewpoint || "",
      audience: t.audience || "",
      notes: t.writing_notes || "",
      platform,
      priority: PRIORITIES.has(t.priority) ? t.priority : "中",
      status: TOPIC_STATUS.TODO,
    }, {
      // 状态是人在拨的开关，重跑不能把「撰写中」打回「待写」
      preserve: ["status"],
    });

    await linkTopicInbox(env, upserted.id, sourceIds);
    if (linkedMaterialIds.length) await linkTopicMaterials(env, upserted.id, linkedMaterialIds);

    if (upserted.created) {
      createdCount++;
      createdTopics.push({
        id: upserted.id, title: t.topic.slice(0, 200),
        viewpoint: t.viewpoint || "", audience: t.audience || "", platform,
      });
    }
    topicCount++;
    for (const id of sourceIds) linkedInspirations.add(id);
    console.log(`synthesize: topic ${upserted.created ? "created" : "reused"} — ${t.topic}`);
  }

  // 只有确实被已落库选题引用的灵感才改终态；且必须等所有选题 upsert 完成。
  const usedIds = [...linkedInspirations];
  const marked = await updateStatusMany(env, "inbox", usedIds, INBOX_STATUS.CLUSTERED);
  console.log(`synthesize: ${topicCount} topic(s), ${marked} inspiration(s) marked 已选题`);
  return { topics: createdCount, upserted: topicCount, marked, createdTopics };
}
