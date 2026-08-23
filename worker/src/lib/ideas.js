// 「找题」那两条的纯逻辑。**不碰 env。**
//
// ⚠️ **为什么在 `lib/` 而不是 `workbench.js` 里**：后者 import 了 `prompt/*.md`
//（wrangler 的 Text 模块），node 加载不了它——**放那儿就等于这段校验没有测试**。
// `keepRealPicks` / `contextLine` / `normalizeSeedInput` 都是因为同一个原因挪出来的。
//
// **这两条端点都只读，一行都不往库里写。** 它们回的是「你可以写什么」的候选，
// 而候选变成种子这件事**必须经过你补一句 take**——那是这条链的核心，
// 一个能直接落库的「一键选题」等于把它绕开。

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * 模型给的角度 → 能显示的候选。
 *
 * ⚠️ **`angle` 空的整条丢掉。** 它是这张卡上唯一必须有的东西——
 * 只有 `why` 的一条在屏幕上就是一段没有主语的解释。
 */
export function keepRealAngles(raw, limit = 6) {
  const out = [];
  for (const one of Array.isArray(raw) ? raw : []) {
    const angle = text(one?.angle).slice(0, 200);
    if (!angle || out.some((x) => x.angle === angle)) continue;
    out.push({ angle, why: text(one?.why).slice(0, 200) });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 素材聚出来的角度。在 `keepRealAngles` 之上多一条：**引用的素材必须真的存在**。
 *
 * ⚠️ **模型会编 id**（`keepRealPicks` 就是为这件事存在的）。编出来的 id 在界面上
 * 是一条点不开的引用；更糟的是它让这个角度看起来「有依据」，而那份依据是假的。
 *
 * ⚠️ **只连上一条素材的角度也丢掉。** 这条端点的全部价值是**跨条的连接**——
 * 单条素材你自己翻的时候就看见了，不需要模型再念一遍。
 */
export function keepGroundedAngles(raw, materials, limit = 6) {
  const byId = new Map((materials || []).map((m) => [String(m.id), m]));
  const out = [];
  for (const one of Array.isArray(raw) ? raw : []) {
    const angle = text(one?.angle).slice(0, 200);
    if (!angle || out.some((x) => x.angle === angle)) continue;
    const ids = [...new Set((Array.isArray(one?.material_ids) ? one.material_ids : [])
      .map((v) => String(v || ""))
      .filter((id) => byId.has(id)))];
    if (ids.length < 2) continue;
    out.push({
      angle,
      why: text(one?.why).slice(0, 200),
      materialIds: ids,
      // 标题跟着回去：界面要显示「靠哪几条」，而它不该为此再查一次库
      evidence: ids.map((id) => text(byId.get(id).title).slice(0, 80)),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 日期范围 → unix 秒的闭区间。
 *
 * ⚠️ **`to` 要含当天整天。** 传 `2026-08-23` 时如果按 00:00 截止，
 * 当天存的素材一条都取不到——而「我今天存的那几条呢」是最容易被问的那句。
 */
export function rangeSeconds(from, to) {
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const a = day(from);
  const b = day(to);
  if (!a || !b) {
    const err = new Error("日期范围不合法");
    err.hint = "格式是 YYYY-MM-DD，开始和结束都要给";
    err.status = 400;
    throw err;
  }
  const start = Math.floor(Date.parse(`${a}T00:00:00Z`) / 1000);
  const end = Math.floor(Date.parse(`${b}T23:59:59Z`) / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    const err = new Error("结束日期不能早于开始日期");
    err.status = 400;
    throw err;
  }
  return { start, end };
}

/**
 * 一张选题卡上允许出现的字段。**白名单，不是黑名单。**
 *
 * ⚠️ **`传播潜力` / `紧急程度` / `热度` 这类不在里面，而且不许加回来。**
 * 它们是模型对市场的猜测，使用者**核实不了**——而这条链上每一处都建立在
 * 「不让模型替你判断」上（真实性闸门、reaction 必须你填、候选点了才挂素材）。
 * 在卡上摆一个「传播潜力：高」，一周之后你就会当它是真的。
 */
export const CARD_FIELDS = Object.freeze(["angle", "audience", "pain", "materials", "why", "form", "effort"]);

const FORMS = new Set(["深度长文", "短帖", "清单体", "故事体", "问答体"]);
const EFFORTS = new Set(["轻", "中", "重"]);

/**
 * 模型给的一张卡 → 能显示的卡。
 *
 * ⚠️ **`material_ids` 必须逐个在库里查得到**（和 `keepRealPicks` 同一条）。
 * 编出来的 id 在界面上是一条点不开的引用，而更糟的是它让这张卡
 * **看起来有依据**——**假依据比没有依据糟得多**。
 *
 * ⚠️ **`angle` 空的整张卡丢掉。** 它是这张卡上唯一必须有的东西：
 * 使用者是照着这句话决定要不要点开的。
 */
export function normalizeCard(raw, materials, fallbackAngle = "") {
  const byId = new Map((materials || []).map((m) => [String(m.id), m]));
  const angle = text(raw?.angle).slice(0, 200) || text(fallbackAngle).slice(0, 200);
  if (!angle) return null;

  const picked = [];
  for (const one of Array.isArray(raw?.material_ids) ? raw.material_ids : []) {
    // 模型有时给字符串、有时给 {id, use}，两种都认
    const id = String((typeof one === "string" ? one : one?.id) || "");
    if (!byId.has(id) || picked.some((x) => x.id === id)) continue;
    picked.push({
      id,
      title: text(byId.get(id).title).slice(0, 80),
      use: text(typeof one === "string" ? "" : one?.use).slice(0, 80),
    });
    if (picked.length >= 6) break;
  }

  return {
    angle,
    audience: text(raw?.audience).slice(0, 120),
    pain: text(raw?.pain).slice(0, 200),
    // 挑不到相关素材是**正常结果**：空数组，界面照实说，不编一条充数
    materials: picked,
    why: text(raw?.why).slice(0, 300),
    // 认不出的形式/工作量留空，**不硬塞一个**——一个瞎猜的「深度长文」会被当成建议
    form: FORMS.has(text(raw?.form)) ? text(raw.form) : "",
    effort: EFFORTS.has(text(raw?.effort)) ? text(raw.effort) : "",
  };
}

/**
 * 一批角度 → 一批卡。**按输入顺序一一对应**，模型少给或顺序乱了都按角度兜底。
 *
 * ⚠️ **模型漏掉某一条时不能整批失败**，也不能让剩下的卡错位挂到别的角度上——
 * 那种错位不报错，而你会照着一张不属于这个角度的卡去写。
 */
export function normalizeCards(raw, angles, materials) {
  const list = Array.isArray(raw?.cards) ? raw.cards : [];
  return (angles || []).map((a, i) => {
    const angle = typeof a === "string" ? a : a?.angle;
    // 先按角度找回对应那张（模型可能重排），找不到才退回位置
    const hit = list.find((c) => text(c?.angle) === text(angle)) || list[i];
    return normalizeCard(hit, materials, angle);
  }).filter(Boolean);
}
