import { PLATFORMS } from "./values.js";

const ID_RE = /^[0-9A-Za-z-]{20,40}$/;
const MODES = new Set(["blank", "material", "interview"]);

const clean = (value, max) => String(value || "").trim().slice(0, max);

export function normalizeCreationRequest(body = {}) {
  const kind = body.kind === "topic" ? "topic" : "draft";
  const title = clean(body.title, 200);
  if (!title) throw new Error(kind === "topic" ? "请填写选题标题" : "请填写文章标题");

  const platform = clean(body.platform, 20);
  if (kind === "draft" && !PLATFORMS.has(platform)) throw new Error("请选择发布平台");
  if (kind === "topic" && platform && !PLATFORMS.has(platform)) throw new Error("发布平台不合法");

  const mode = MODES.has(body.mode) ? body.mode : "blank";
  const materialIds = [...new Set((Array.isArray(body.materialIds) ? body.materialIds : [])
    .map((id) => String(id || ""))
    .filter((id) => ID_RE.test(id)))]
    .slice(0, 30);
  if (mode === "material" && kind === "draft" && !materialIds.length) throw new Error("至少选择一条素材");

  return {
    kind,
    mode,
    title,
    platform,
    viewpoint: clean(body.viewpoint, 2000),
    audience: clean(body.audience, 500),
    body: String(body.body || "").slice(0, 200_000),
    interviewEvidence: String(body.interviewEvidence || "").trim().slice(0, 60_000),
    materialIds,
  };
}

/**
 * 「按意思挑素材」里模型给回来的 id，**必须拿真实候选校验一遍**。
 *
 * 放行一个不存在的 id，工作台上就是一张点了打不开的卡——**比「没找到」糟得多**：
 * 「没找到」是个诚实的答案，一张打不开的卡是个假的答案。重复项同样要去掉
 * （同一条被挑两次，界面上就是同一张卡出现两遍）。
 *
 * 放在 lib 里而不是 `workbench.js` 里，是因为那个文件 import 了 `prompt/*.md`
 * （wrangler 的 Text 模块），node 跑不起来——**测不到的闸门等于没有闸门**，
 * 而这道闸恰恰是界面上完全看不出有没有生效的那一类。
 */
export function keepRealPicks(picked, candidates, limit = 6) {
  const ids = new Set((candidates || []).map((c) => String(c.id)));
  const out = [];
  for (const one of Array.isArray(picked) ? picked : []) {
    const id = String(one?.id || "");
    if (!ids.has(id) || out.some((x) => x.id === id)) continue;
    out.push({ id, why: String(one?.why || "").replace(/\s+/g, " ").trim().slice(0, 60) });
    if (out.length >= limit) break;
  }
  return out;
}
