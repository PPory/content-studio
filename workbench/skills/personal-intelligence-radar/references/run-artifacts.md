# 运行工件与一致性契约

## 目录

1. 为什么要保存 sidecar 工件
2. 目录结构
3. Candidate Registry
4. Verification Queue
5. Fetch Plan
6. Verification Ledger
7. 报告渲染约束
8. 版本与哈希

## 1. 为什么要保存 sidecar 工件

五万 token 左右的材料不能只依赖一次上下文中的隐式记忆。每次运行都要把候选、证据、核实和行动状态保存到 `tmp/insight-work/<week>/`，让以下问题可审计：

- 为什么某条进入 Top Cards，另一条只进 Watchlist？
- 分数、行动和准备度是否一致？
- 哪些事实由一手来源核实，哪些只是官方自述或二手说法？
- “低竞争 / 供给稀缺”是否真的做过内容供给审计？
- 一页结论、卡片和各 Queue 的数量是否来自同一份数据？

这些工件是派生中间件，不放入 Vault，不让 Obsidian 索引。

## 2. 目录结构

```text
tmp/insight-work/<YYYY-Www>/
├── manifest.json
├── manifest.md
├── chunks/
├── evidence-ledger.jsonl
├── candidate-registry.json
├── verification-queue.json
├── web/
│   ├── search-results.json
│   ├── fetch-plan.json
│   ├── fetch-results.json
│   └── pages/*.md
└── verification-ledger.jsonl
```

- `evidence-ledger.jsonl`：从三份材料抽出的证据单元。
- `candidate-registry.json`：所有候选的唯一状态源。
- `verification-queue.json`：待搜索的最小承重主张与内容供给查询。
- `web/search-results.json`：Brave Search 的规范化结果。
- `web/fetch-plan.json`：AI 看过搜索结果后选出的 URL；不要盲抓全部结果。
- `web/pages/*.md`：Firecrawl 抽取的正文。
- `verification-ledger.jsonl`：逐 claim 的核实结论。

## 3. Candidate Registry

报告所有章节必须从同一份 Registry 渲染。示例：

```json
{
  "schema_version": 2,
  "week": "2026-W33",
  "skill_version": "2.0.0",
  "generated_at": "2026-08-12T20:00:00Z",
  "materials": {
    "reddit": {"sha256": "...", "path": "..."},
    "x": {"sha256": "...", "path": "..."},
    "aihot": {"sha256": "...", "path": "..."}
  },
  "candidates": [
    {
      "candidate_id": "IC-01",
      "title": "Agent 权限治理正在分成命令安全与多方意图安全两层",
      "top_card": true,
      "action_sequence": ["Learn", "Write"],
      "primary_action": "Learn",
      "queue_status": "needs_research",
      "priority_score": 85,
      "score_basis": {
        "novelty": 5,
        "importance": 5,
        "evidence": 3,
        "depth": 5,
        "learning": 4,
        "content": 5,
        "penalty": 5
      },
      "fact_status": "Official claim only",
      "pattern_maturity": "Cross-source",
      "interpretation_confidence": "Medium-high",
      "opportunity_validation": "Supply-audited",
      "independent_evidence_groups": 2,
      "source_types": 2,
      "load_bearing_unverified": false,
      "report_sections": ["top_card", "learn_queue", "write_queue"]
    }
  ]
}
```

约束：

- `priority_score` 四舍五入到 5 的倍数；精确小数不代表真实校准。
- `primary_action` 等于 `action_sequence` 的第一项。
- `queue_status` 使用 `ready / needs_research / weak_signal / watch / ignore`。
- 一页结论的行动计数按所有候选的 `primary_action` 生成，不要在正文里重新手数。
- Top Card、Learn Queue、Write Queue、Watchlist 只引用 Registry 中的 `candidate_id`，不要各自创造新状态。

## 4. Verification Queue

先生成候选，再挑承重主张。不要在第一次读材料时就联网，以免搜索结果覆盖材料自身的信号。

```json
{
  "schema_version": 1,
  "week": "2026-W33",
  "claims": [
    {
      "claim_id": "IC-01-C1",
      "candidate_id": "IC-01",
      "claim": "Anthropic 称分类器拦截 89%，人工审批拦截 14%",
      "claim_type": "numerical_comparison",
      "load_bearing": true,
      "tier": 2,
      "queries": [
        {
          "query_id": "IC-01-C1-support",
          "purpose": "support",
          "q": "Anthropic Claude Code auto mode 89% 14% evaluation methodology",
          "country": "US",
          "search_lang": "en",
          "freshness": "2026-08-01to2026-08-12",
          "count": 8
        },
        {
          "query_id": "IC-01-C1-counter",
          "purpose": "counter",
          "q": "independent evaluation criticism Claude Code auto mode 89% 14%",
          "country": "US",
          "search_lang": "en",
          "freshness": "pm",
          "count": 8
        }
      ]
    }
  ]
}
```

`purpose` 只使用：

- `support`：寻找一手事实或支持材料。
- `counter`：寻找反例、口径冲突和竞争解释。
- `supply`：审计目标语言和平台上的内容供给。

每周通常只核实 Top 3–5 候选中的 8–15 条承重 claim。

## 5. Fetch Plan

Brave Search 只负责发现 URL。AI 读完 `search-results.json` 后，按来源质量、独立性和相关性挑选要让 Firecrawl 抽取的页面：

```json
{
  "schema_version": 1,
  "week": "2026-W33",
  "pages": [
    {
      "claim_id": "IC-01-C1",
      "query_id": "IC-01-C1-support",
      "purpose": "support",
      "source_role": "official",
      "url": "https://example.com/original-source",
      "expected_evidence": "评测样本、指标定义与测试条件",
      "max_age_ms": 21600000
    }
  ]
}
```

规则：

- 同一 URL 只抓一次，可关联多个 claim。
- 优先官方、论文、仓库、当事方完整声明；再选独立媒体或反方来源。
- 不把同一新闻稿的十次转载当成十个来源。
- 不抓登录墙、明显聚合页或只重复搜索摘要的页面，除非没有替代来源。

## 6. Verification Ledger

每行一个 JSON 对象：

```json
{"claim_id":"IC-01-C1","candidate_id":"IC-01","claim":"...","claim_type":"numerical_comparison","load_bearing":true,"status":"partially_verified","fact_status":"Official claim only","source_independence":"single_interested_party","supporting_sources":[{"url":"https://...","source_type":"official","retrieved_at":"2026-08-12","evidence":"..."}],"contradicting_sources":[],"missing_information":["样本是否相同","人工组测试条件"],"report_wording":"Anthropic 厂商自测称……","confidence_effect":"interpretation capped at Medium","supply_audit":null}
```

`status` 使用：

- `verified`
- `partially_verified`
- `contradicted`
- `unverified`
- `not_applicable`

内容供给审计条目另带：

```json
{
  "claim_type": "content_supply",
  "supply_audit": {
    "target_language": "zh",
    "target_surface": "public_web",
    "window": "90d",
    "queries": ["..."],
    "closest_competitors": [
      {"url": "https://...", "coverage": "news_rewrite", "gap": "no mechanism"}
    ],
    "verdict": "解释供给存在，但缺少方法论框架",
    "coverage_limit": "不代表微信/小红书站内全量"
  }
}
```

## 7. 报告渲染约束

- 卡片、Queue 和一页结论都从 Registry 渲染。
- `Write` 作为第一行动时，`queue_status` 必须为 `ready`，且 `opportunity_validation` 必须为 `Supply-audited` 或 `Validated`。
- 若还需补论文、方法或承重事实，使用 `Learn → Write` 或 `Explore → Write`。
- `Pattern maturity = Single event` 时，不得用“稳定、持续、正在成为、行业趋势”等模式性标题。
- `priority_score < 75` 不得进入 Top Cards；放入 Queue 或 Emerging Signals。
- 先做跨候选综合：如果两张事件卡可以上升为同一个结构性判断，优先保留上层 synthesis，把事件当作证据。

## 8. 版本与哈希

最终报告 YAML frontmatter 至少记录：

```yaml
week: 2026-W33
report_schema: 2
skill_version: 2.0.0
generated_at: 2026-08-12T20:00:00Z
material_manifest_sha256: ...
candidate_registry_sha256: ...
verification_ledger_sha256: ...
```

先写完 Registry 和 Verification Ledger，再计算哈希并生成报告。重跑同一周时可据此判断报告是否对应同一批材料和同一版 Skill。
