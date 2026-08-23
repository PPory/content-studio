// 「找题」那两条端点的纯逻辑（`lib/ideas.js`）。
//
// 这两条**只读，一行都不往库里写**——它们回的是「你可以写什么」的候选，
// 而候选变成种子必须经过你补一句 take。一个能直接落库的「一键选题」
// 等于把这条链的核心绕开。

import test from "node:test";
import assert from "node:assert/strict";
import { keepRealAngles, keepGroundedAngles, rangeSeconds, normalizeCard, normalizeCards, CARD_FIELDS } from "../src/lib/ideas.js";

test("没有 angle 的整条丢掉", () => {
  // `angle` 是这张卡上唯一必须有的东西——只有 `why` 的一条在屏幕上
  // 就是一段没有主语的解释
  const out = keepRealAngles([{ why: "有理由但没角度" }, { angle: "  " }, { angle: "真角度", why: "因为…" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].angle, "真角度");
});

test("重复的角度只留一条，条数有上限", () => {
  const same = [{ angle: "同一个" }, { angle: "同一个" }, { angle: "另一个" }];
  assert.equal(keepRealAngles(same).length, 2);
  assert.equal(keepRealAngles(Array.from({ length: 20 }, (_, i) => ({ angle: `第${i}条` })), 4).length, 4);
});

test("坏输入不炸", () => {
  for (const bad of [null, undefined, "字符串", 42, {}]) assert.deepEqual(keepRealAngles(bad), []);
});

/**
 * ⚠️ **模型会编 id**（`keepRealPicks` 就是为这件事存在的）。
 * 编出来的 id 在界面上是一条点不开的引用；更糟的是它让这个角度看起来
 * **「有依据」，而那份依据是假的**。
 */
test("引用了不存在的素材，整条角度丢掉", () => {
  const materials = [{ id: "m1", title: "真的一条" }, { id: "m2", title: "真的两条" }];
  assert.equal(keepGroundedAngles([{ angle: "A", material_ids: ["m1", "编的"] }], materials).length, 0,
    "只剩一条真 id 时不该放行");
  assert.equal(keepGroundedAngles([{ angle: "A", material_ids: ["m1", "m2"] }], materials).length, 1);
});

/**
 * ⚠️ **只连上一条素材的角度也丢掉。**
 * 这条端点的全部价值是**跨条的连接**——单条素材你自己翻的时候就看见了，
 * 不需要模型再念一遍。
 */
test("只靠一条素材的角度不算数", () => {
  const materials = [{ id: "m1", title: "孤零零" }, { id: "m2", title: "另一条" }];
  assert.equal(keepGroundedAngles([{ angle: "A", material_ids: ["m1"] }], materials).length, 0);
  // 重复 id 去重之后也只剩一条，同样不算
  assert.equal(keepGroundedAngles([{ angle: "A", material_ids: ["m1", "m1"] }], materials).length, 0);
});

test("依据的标题跟着回去，界面不用再查一次库", () => {
  const materials = [{ id: "m1", title: "复利不是利滚利" }, { id: "m2", title: "写作的杠杆" }];
  const [one] = keepGroundedAngles([{ angle: "A", why: "两条互相印证", material_ids: ["m1", "m2"] }], materials);
  assert.deepEqual(one.materialIds, ["m1", "m2"]);
  assert.deepEqual(one.evidence, ["复利不是利滚利", "写作的杠杆"]);
});

/**
 * ⚠️ **`to` 要含当天整天。**
 * 按 00:00 截止的话，当天存的素材一条都取不到——而「我今天存的那几条呢」
 * 是最容易被问的那句。
 */
test("日期范围含结束当天一整天", () => {
  const { start, end } = rangeSeconds("2026-08-23", "2026-08-23");
  assert.equal(end - start, 86399, "同一天应该是一整天，不是 0 秒");
  assert.ok(start < end);
});

test("日期不合法就抛，而且带下一步", () => {
  assert.throws(() => rangeSeconds("", "2026-08-23"), /日期范围不合法/);
  assert.throws(() => rangeSeconds("2026/08/23", "2026-08-23"), /日期范围不合法/);
  assert.throws(() => rangeSeconds("2026-08-23", "2026-08-01"), /不能早于/);
  try {
    rangeSeconds("坏的", "更坏的");
  } catch (e) {
    // 报错要带下一步：光说「不合法」，用户不知道该干嘛
    assert.match(e.hint || "", /YYYY-MM-DD/);
    assert.equal(e.status, 400);
  }
});

/**
 * ⚠️ **卡上不许出现「传播潜力 / 紧急程度 / 热度」这类字段。**
 *
 * 它们是模型对市场的猜测，使用者**核实不了**——而这条链上每一处都建立在
 * 「不让模型替你判断」上（真实性闸门、reaction 必须你填、候选点了才挂素材）。
 * 摆一个「传播潜力：高」在卡上，一周之后你就会当它是真的。
 *
 * 这条钉的是**白名单没有被悄悄放宽**：模型多吐几个字段，也一个都进不来。
 */
test("卡片字段是白名单，市场猜测类的一个都进不来", () => {
  const card = normalizeCard({
    angle: "A", audience: "B", pain: "C", why: "D", form: "短帖", effort: "轻",
    // 模型自作主张多给的几项
    传播潜力: "高", urgency: "本周必须做", heat: 99, competition: "低",
  }, []);
  assert.deepEqual(Object.keys(card).sort(), [...CARD_FIELDS].sort());
  for (const gone of ["传播潜力", "urgency", "heat", "competition"]) {
    assert.ok(!(gone in card), `${gone} 混进卡片了——那是模型对市场的猜测，用户核实不了`);
  }
});

test("编造的素材 id 进不了卡片", () => {
  const mats = [{ id: "m1", title: "真的" }];
  const card = normalizeCard({ angle: "A", material_ids: ["m1", "编的", { id: "也是编的" }] }, mats);
  assert.deepEqual(card.materials.map((m) => m.id), ["m1"]);
  // ⚠️ 挑不到是**正常结果**：空数组，而不是硬塞一条充数
  assert.deepEqual(normalizeCard({ angle: "A", material_ids: ["全是编的"] }, mats).materials, []);
});

test("认不出的形式和工作量留空，不硬塞一个", () => {
  const card = normalizeCard({ angle: "A", form: "爆款体", effort: "超重" }, []);
  assert.equal(card.form, "", "瞎猜一个「深度长文」会被当成建议");
  assert.equal(card.effort, "");
  assert.equal(normalizeCard({ angle: "A", form: "清单体", effort: "重" }, []).form, "清单体");
});

/**
 * ⚠️ **模型重排或漏给时不能让卡片错位挂到别的角度上。**
 * 那种错位**不报错**，而你会照着一张不属于这个角度的卡去写。
 */
test("模型乱序或漏给，卡片仍然对得上角度", () => {
  const out = normalizeCards({ cards: [{ angle: "乙", pain: "P乙" }, { angle: "甲", pain: "P甲" }] }, ["甲", "乙"], []);
  assert.deepEqual(out.map((c) => [c.angle, c.pain]), [["甲", "P甲"], ["乙", "P乙"]]);
  // 漏给一条时，那一条用角度兜底，**其余不许错位**
  const short = normalizeCards({ cards: [{ angle: "甲", pain: "P甲" }] }, ["甲", "乙"], []);
  assert.deepEqual(short.map((c) => c.angle), ["甲", "乙"]);
  assert.equal(short[1].pain, "");
});
