// 种子（`lib/seeds.js`）。
//
// **种子 = 你看到的东西 + 你对它的一句话。** 这一组钉的是它和「收藏」的区别：
// 收藏只要一个链接，种子必须带着你的判断——**没有那句话，它就只是又一条收藏**，
// 而那条路已经有了。

import test from "node:test";
import assert from "node:assert/strict";
import {
  mapSeed,
  normalizeSeedInput,
  normalizeSeedPatch,
  seedCounts,
  seedReactions,
  seedStatuses,
} from "../src/lib/seeds.js";
import { SEED_REACTIONS, SEED_STATUS } from "../src/lib/values.js";

test("没有那句话就不是种子", () => {
  assert.throws(() => normalizeSeedInput({ sourceTitle: "某篇文章", sourceUrl: "https://x/1" }), /还没写你的看法/);
  assert.throws(() => normalizeSeedInput({ take: "   \n  " }), /还没写你的看法/);
  // 报错要带下一步：光说"不合法"，用户不知道该干嘛
  try {
    normalizeSeedInput({});
  } catch (e) {
    assert.match(e.hint, /收藏/);
    assert.equal(e.status, 400);
  }
});

test("只要有那句话就成立，别的都能空", () => {
  // ⚠️ 干活时想到的那类**没有触发物**，而那往往是你最有话说的——不能因此被拒
  const seed = normalizeSeedInput({ take: "工具选择看的是配置成本，不是功能" });
  assert.equal(seed.sourceKind, "none");
  assert.equal(seed.reaction, "");
  assert.equal(seed.take, "工具选择看的是配置成本，不是功能");
});

/**
 * ⚠️ **reaction 认不出时清空，不报错。**
 * 那七条是提示语不是枚举：用户可能有话说但不属于任何一种（**硬塞一个分类比留空更糟**），
 * 而前端传来一个过期的措辞（改过文案、开着旧标签页）也不该让他那句话丢掉。
 * **清单是快车道，不是闸门。**
 */
test("认不出的反应清空，不是把整条打回", () => {
  const seed = normalizeSeedInput({ take: "有话说", reaction: "这个分类不存在" });
  assert.equal(seed.reaction, "");
  assert.equal(seed.take, "有话说");

  const kept = normalizeSeedInput({ take: "有话说", reaction: SEED_REACTIONS[1] });
  assert.equal(kept.reaction, "不同意，因为…");
});

test("触发物类型不合法要拒", () => {
  assert.throws(() => normalizeSeedInput({ take: "x", sourceKind: "书架" }), /触发物类型不合法/);
  for (const kind of ["none", "hot", "inbox", "material"]) {
    assert.equal(normalizeSeedInput({ take: "x", sourceKind: kind }).sourceKind, kind);
  }
});

/**
 * ⚠️ **热点不在库里**（它是快照，会过期、会被覆盖），所以标题和链接要冗余存一份。
 * 只存 id 的话，几天后这颗种子就说不清自己从哪来了。
 */
test("触发物的标题和链接跟着存下来", () => {
  const seed = normalizeSeedInput({
    take: "不同意——卡住的不是归因",
    reaction: SEED_REACTIONS[1],
    sourceKind: "hot",
    sourceTitle: "深度归因要在可操作性和本质性之间平衡",
    sourceUrl: "https://example.com/a",
  });
  assert.equal(seed.sourceTitle, "深度归因要在可操作性和本质性之间平衡");
  assert.equal(seed.sourceUrl, "https://example.com/a");
});

test("改种子走白名单，不是黑名单", () => {
  assert.deepEqual(normalizeSeedPatch({ status: "写了" }), { status: "写了" });
  assert.deepEqual(normalizeSeedPatch({ take: " 改过的看法 " }), { take: "改过的看法" });
  // 放开任意字段意味着一个笔误就能把 source_kind 写成非法值
  assert.throws(() => normalizeSeedPatch({ sourceKind: "乱写" }), /没有可改的字段/);
  assert.throws(() => normalizeSeedPatch({ status: "随便一个状态" }), /状态不合法/);
  // 改成空白等于把种子掏空——要放弃就标「不写了」
  assert.throws(() => normalizeSeedPatch({ take: "  " }), /不能改成空的/);
});

/**
 * ⚠️ **三个状态都要出现在计数里，哪怕是 0。**
 * 少一档的话界面上那一格会凭空消失，看着像功能坏了，而不是"这一档是空的"。
 */
test("计数三档都在，空的也报 0", () => {
  const counts = seedCounts([{ status: "攒着" }, { status: "攒着" }, { status: "写了" }]);
  assert.deepEqual(counts, { 攒着: 2, 写了: 1, 不写了: 0 });
  assert.deepEqual(seedCounts([]), { 攒着: 0, 写了: 0, 不写了: 0 });
  // 认不出的状态不算进任何一档，也不能让整个计数挂掉
  assert.deepEqual(seedCounts([{ status: "火星状态" }]), { 攒着: 0, 写了: 0, 不写了: 0 });
});

/**
 * ⚠️ **清单跟着响应回，工作台绝不抄第二份。**
 * `sources.js` 那几处 `states` 抄了一份，CLAUDE.md 里记着「对不上就是 400」。
 * 而这七条还会边用边调措辞——抄一份的话改完那边还是老的，**并且不报错**。
 */
test("反应清单就是 values.js 那一份", () => {
  assert.deepEqual(seedReactions(), [...SEED_REACTIONS]);
  assert.equal(seedReactions().length, 7);
  // 逐条不同：七行一样的提示语等于没有提示
  assert.equal(new Set(seedReactions()).size, 7);
  // 前两条是最常用也最好下笔的，顺序有意义
  assert.match(seedReactions()[0], /同意/);
  assert.match(seedReactions()[1], /不同意/);
  // 返回的是副本，调用方改不动真源
  const copy = seedReactions();
  copy.push("外来的");
  assert.equal(seedReactions().length, 7);
});

test("状态清单和 values.js 对得上", () => {
  assert.deepEqual(seedStatuses(), Object.values(SEED_STATUS));
});

test("库里的行压平成对外契约", () => {
  const seed = mapSeed({
    id: "01ABC", take: "我的看法", reaction: "不同意，因为…",
    source_kind: "hot", source_id: "", source_title: "原文标题", source_url: "https://x/1",
    status: "攒着", draft_id: null, created_at: 1_786_000_000, updated_at: 1_786_000_100,
  });
  assert.equal(seed.source.title, "原文标题");
  assert.equal(seed.status, "攒着");
  assert.equal(seed.draftId, null);
  assert.match(seed.updatedAt, /^2026-/);
  // 不回数据库原始列名——工作台拿到的永远是这个形状，换库时它一行都不用改
  assert.ok(!("source_kind" in seed));
  assert.ok(!("updated_at" in seed));
});
