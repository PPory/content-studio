/**
 * 模型厂商的识别与排序。
 *
 * ⚠️ **这里认的是「哪家做的」，不是「叫什么名字」。**
 * 上一版直接拿 tabler 里形状最接近的图标凑：Claude 用一个字母 A、DeepSeek 用一条鱼、
 * GLM 用字母 Z、Qwen 用字母 Q。字母图标传达不了品牌——一列模型扫下来，
 * 用户看到的是 A/K/Q/Z 四个方块，还得逐个读文字才知道谁是谁，
 * 图标那一列等于白占位置。现在每家用自己标志的**单色简化形**（画在 icons.jsx 里）。
 *
 * 判据只写这一处：图标、显示名、分组顺序都从这里出去，菜单只负责画。
 */

/**
 * 顺序即菜单里的分组顺序。**匹配从上往下短路**，所以更具体的规则必须排在更宽的前面
 * （`gpt` 会命中 OpenAI，但 `gpt` 也可能出现在别家的兼容命名里，
 * 所以自有品牌词一律排在 `openai` 之前）。
 */
const BRANDS = [
  { key: "anthropic", label: "Anthropic", match: /claude|anthropic|sonnet|haiku|opus/ },
  { key: "openai", label: "OpenAI", match: /\bgpt|openai|\bo[134]\b|codex/ },
  { key: "google", label: "Google", match: /gemini|google|gemma/ },
  { key: "xai", label: "xAI", match: /grok|\bxai\b/ },
  { key: "deepseek", label: "DeepSeek", match: /deepseek/ },
  { key: "moonshot", label: "月之暗面", match: /kimi|moonshot/ },
  { key: "zhipu", label: "智谱", match: /\bglm|zhipu|chatglm/ },
  { key: "qwen", label: "通义千问", match: /qwen|tongyi|alibaba|dashscope/ },
  { key: "minimax", label: "MiniMax", match: /minimax|abab/ },
  { key: "meta", label: "Meta", match: /llama|meta-/ },
  { key: "mistral", label: "Mistral", match: /mistral|mixtral|magistral/ },
];

const OTHER = { key: "other", label: "其他模型" };

export function modelBrand(id = "", provider = "") {
  const value = `${id} ${provider}`.toLowerCase();
  return BRANDS.find((brand) => brand.match.test(value)) || OTHER;
}

/** 菜单里的分组顺序：认识的厂商按 BRANDS 的顺序，其余归到「其他模型」排最后。 */
export function brandRank(key) {
  const index = BRANDS.findIndex((brand) => brand.key === key);
  return index === -1 ? BRANDS.length : index;
}

/**
 * 把模型按厂商分组。
 *
 * ⚠️ **同一家必须连着排。** 上一版直接用接口返回的顺序，于是
 * `gpt-5 / claude / gpt-4 / glm / claude-haiku` 交叉着出现——
 * 换模型时用户找的几乎总是「同一家的另一档」，穿插排列等于每次都要把整列读一遍。
 * 组内保持接口返回的原始顺序（那通常已经是厂商自己的新旧顺序），不自作主张重排。
 */
export function groupModelsByBrand(items = []) {
  const groups = new Map();
  for (const item of items) {
    const brand = modelBrand(item.id, item.provider || item.ownedBy);
    if (!groups.has(brand.key)) groups.set(brand.key, { ...brand, items: [] });
    groups.get(brand.key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => brandRank(a.key) - brandRank(b.key));
}
