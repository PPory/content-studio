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

export function buildMaterialStarter(title, materials = []) {
  const cards = materials.map((material) => {
    const body = String(material.content || "").trim().split("\n").map((line) => `> ${line}`).join("\n");
    return `### ${material.title || "未命名素材"}\n\n${body || "> （这条素材没有正文）"}`;
  });
  return [
    `# ${title}`,
    "",
    "<!-- 以下是本次起稿选中的素材。写完后可删掉这一段。 -->",
    "## 写作素材",
    "",
    cards.join("\n\n"),
    "",
    "---",
    "",
  ].join("\n");
}
