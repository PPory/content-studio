// 异步补标签（仅当用户没手动 #标签 时）：不阻塞入库，失败静默。
// Bot 存素材与 /推 落库共用。

import { TAG_PROMPT } from "../prompts.js";
import { chatJson } from "./llm.js";
import { setTags } from "./db.js";

export async function autoTag(env, materialId, type, content) {
  try {
    const { json } = await chatJson(env, {
      system: TAG_PROMPT,
      user: JSON.stringify({ 类型: type, 内容: content.slice(0, 2000) }),
      maxTokens: 2000, // thinking 模型会先耗 token 思考，留足余量免得 JSON 被截断
      task: "utility",
    });
    if (Array.isArray(json.tags) && json.tags.length) {
      await setTags(env, "material", materialId, json.tags.slice(0, 4));
    }
  } catch (e) {
    console.warn(`auto-tag failed for ${materialId}:`, e.message);
  }
}
