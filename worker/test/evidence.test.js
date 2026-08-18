import test from "node:test";
import assert from "node:assert/strict";

import { personalEvidence } from "../src/lib/db.js";
import { EVIDENCE_MATERIAL_TYPES, auditPersonalNarrative } from "../src/lib/integrity.js";

// 最小 D1 替身：只记下 SQL 和参数，按固定行集回答。
function fakeEnv(rows) {
  const seen = { sql: "", params: [] };
  return {
    seen,
    env: {
      DB: {
        prepare(sql) {
          seen.sql = sql;
          return {
            bind(...params) {
              seen.params = params;
              return { all: async () => ({ results: rows }) };
            },
          };
        },
      },
    },
  };
}

const STORY = "前几天跟一个朋友聊天，他说他的自媒体做了半年，一直没起色。";

test("取证据的 SQL 和闸门认的类型是同一份清单", async () => {
  const { env, seen } = fakeEnv([]);
  await personalEvidence(env);
  assert.deepEqual(seen.params, EVIDENCE_MATERIAL_TYPES);
  assert.match(seen.sql, /type IN \((\?,\s*)*\?\)/);
});

test("素材的 content 压成闸门要的 note", async () => {
  const { env } = fakeEnv([{ id: "m1", title: "和朋友的对话", type: "个人经历", content: STORY }]);
  const evidence = await personalEvidence(env);
  assert.equal(evidence[0].note, STORY);
  assert.equal(auditPersonalNarrative(STORY, evidence).ungrounded.length, 0);
});

// 这条盯的就是那个 bug：证据挂在哪个选题下、是不是本次成稿的输入，都不该改变判定。
// 同一段话，证据在库里 → 放行；证据够不着 → 报缺依据，差别只能来自「有没有这条经历」。
test("经历只要在库里就算数，不看它挂在哪个选题下", async () => {
  const { env } = fakeEnv([{ id: "m1", title: "别的选题下的经历", type: "个人经历", content: STORY }]);
  assert.deepEqual(auditPersonalNarrative(STORY, await personalEvidence(env)).ungrounded, []);
  assert.deepEqual(auditPersonalNarrative(STORY, []).ungrounded, [STORY]);
});

/**
 * 连着的几句已经在 `findSpecificPersonalClaims` 里并成一条，所以闸门问的是
 * 「这**一整段**有没有依据」。
 *
 * ⚠️ 这里钉住的是一个**有意留着的宽松处**：`isPersonalClaimGrounded` 里有一句
 * `claimText.includes(evidenceText)`，于是录下前半段就能让整段过闸。合并让这个宽松处
 * 覆盖的文字变长了——把它收紧（只留「证据包含叙事」那个方向）会让闸门更严，
 * 但那是改闸门的语义，得单独决定，不该作为一次界面改动的副作用溜进来。
 */
test("整段的依据：录了其中一段就算数（当前口径）", async () => {
  const passage = `${STORY}\n\n我问他：你觉得问题出在哪？`;

  const half = fakeEnv([{ id: "m1", title: "只记了前半段", type: "个人经历", content: STORY }]);
  assert.deepEqual(auditPersonalNarrative(passage, await personalEvidence(half.env)).ungrounded, []);

  const none = fakeEnv([{ id: "m1", title: "无关经历", type: "个人经历", content: "去年我去过一趟云南，在大理住了三天。" }]);
  assert.deepEqual(auditPersonalNarrative(passage, await personalEvidence(none.env)).ungrounded, [passage]);
});

// 界面上「2 处待核实经历」曾经数的是句子。连着的两句是同一个场景，数成两处的话，
// 补录时只填其中一句，另一句照样够不着依据——补了还在报，看着像修不好。
test("连着的两句在界面上是一条，不是两条", () => {
  const passage = [
    "前几天跟一个朋友聊天，他说他的自媒体做了半年，一直没起色。", "",
    "我问他：你觉得问题出在哪？",
  ].join(String.fromCharCode(10));
  const audit = auditPersonalNarrative(passage, []);
  assert.equal(audit.ungrounded.length, 1);
  assert.match(audit.ungrounded[0], /一直没起色。[\s\S]*我问他/);
});

test("extra 是本次现给的证据，追加而不是替换", async () => {
  const { env } = fakeEnv([{ id: "m1", title: "库里的", type: "个人经历", content: "无关的一段经历。" }]);
  const evidence = await personalEvidence(env, [{ type: "个人经历", note: STORY }]);
  assert.equal(evidence.length, 2);
  assert.deepEqual(auditPersonalNarrative(STORY, evidence).ungrounded, []);
});
