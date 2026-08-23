// 素材的来源上下文（`lib/db.js` 的 `sourceContextOf` / `contextLine`）。
//
// 这一组钉的是「拆」这个动作欠下的债：初筛把一篇文章拆成原子素材，好处是可复用、
// 可逐字核验，代价是**每条素材都不带它成立的前提**——而成稿时喂给模型的一直只有碎片。
// 原文就躺在 `inbox` 里，从来没人回去读。

import test from "node:test";
import assert from "node:assert/strict";
import { contextLine, sourceContextOf } from "../src/lib/db.js";

/** 只够 `all()` 用的假 D1：把 bind 到的参数原样交给 rows 函数 */
function fakeEnv(rows) {
  const calls = [];
  return {
    calls,
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            calls.push({ sql, params });
            return { async all() { return { results: rows(params) }; } };
          },
        };
      },
    },
  };
}

const INBOX = {
  "ib-1": { id: "ib-1", title: "你以为你在思考", verdict: "值得深挖", card_markdown: "整篇在讲归因的两种动机" },
  "ib-2": { id: "ib-2", title: "收藏当成学会", verdict: "", card_markdown: "" },
};

test("拆出来的素材能找回它那一篇", async () => {
  const env = fakeEnv((params) => params.map((id) => INBOX[id]).filter(Boolean));
  const map = await sourceContextOf(env, [
    { id: "m-1", inbox_id: "ib-1" },
    { id: "m-2", inbox_id: "ib-1" },
    { id: "m-3", inbox_id: "ib-2" },
  ]);
  assert.equal(map.get("m-1").title, "你以为你在思考");
  // 同一篇拆出来的多条，各自都要拿到同一份上下文
  assert.equal(map.get("m-2").card, "整篇在讲归因的两种动机");
  assert.equal(map.get("m-3").title, "收藏当成学会");
  // ⚠️ 一次查询取回全部来源，不能退回成每条素材查一次
  assert.equal(env.calls.length, 1, JSON.stringify(env.calls));
  assert.deepEqual(env.calls[0].params, ["ib-1", "ib-2"]);
});

/**
 * ⚠️ **手动入库的素材本来就没有来源。**
 * `/金句` 那类命令直接写素材库，`inbox_id` 为空。这时拿不到上下文是**对的**，
 * 调用方要照实说「这条是你直接存的」，而不是给一个指向空处的上下文。
 * 库里 32 条素材有 5 条是这样的。
 */
test("手动入库的素材没有来源，也不该去查", async () => {
  const env = fakeEnv(() => []);
  const map = await sourceContextOf(env, [{ id: "m-9", inbox_id: null }, { id: "m-8" }]);
  assert.equal(map.size, 0);
  // 一条都不用查——没有 inbox_id 就没有可查的东西
  assert.equal(env.calls.length, 0);
});

test("没有素材时不查库", async () => {
  const env = fakeEnv(() => []);
  assert.equal((await sourceContextOf(env, [])).size, 0);
  assert.equal(env.calls.length, 0);
});

/**
 * ⚠️ **上下文有字数上限。**
 * `card_markdown` 长度不受控，六条主料各带一篇的话很容易吃掉整个 prompt 预算，
 * 而单篇成稿的输出预算才 16k token。截断比不给强——前几百字已经够说清"这篇在讲什么"。
 */
test("上下文超长要截断，不能整篇灌进去", () => {
  const line = contextLine({ title: "长文", verdict: "", card: "字".repeat(5000) });
  assert.ok(line.length < 1400, `实际 ${line.length} 字`);
  assert.ok(line.includes("出自《长文》"));
});

test("字段缺了就不画那一行，不留空标签", () => {
  assert.equal(contextLine({ title: "只有标题", verdict: "", card: "" }), "出自《只有标题》");
  assert.equal(contextLine(null), "");
  assert.equal(contextLine(undefined), "");
  // 全是空字段时应该是空串，而不是一串孤零零的冒号
  assert.equal(contextLine({ title: "", verdict: "", card: "" }), "");
});

/**
 * ⚠️ **上下文要被明确标成「不可引用」，这是整件事最容易出错的地方。**
 * 把原文喂进去之后，模型完全可能从背景里摘一句话当依据——而那句话**没有经过逐字核验**，
 * 摘出来就等于给了一个假的出处。逐字保真和核验闸门是这个产品最硬的东西，
 * 不能被一个"顺手加的上下文"绕过去。所以两份提示词里都必须有这条。
 */
test("两份成稿提示词都写明了背景不可引用", async () => {
  const fs = await import("node:fs/promises");
  for (const name of ["draft.md", "material-draft.md"]) {
    const text = await fs.readFile(new URL(`../prompt/${name}`, import.meta.url), "utf8");
    assert.match(text, /不是可引用的素材/, `${name} 缺少「背景不可引用」那条`);
    assert.match(text, /依据只能来自「素材」本身/, `${name} 缺少「依据只能来自素材」那条`);
  }
});
