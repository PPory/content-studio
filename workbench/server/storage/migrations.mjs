import crypto from "node:crypto";
import fs from "node:fs";

const foundationSql = fs.readFileSync(new URL("./migrations/0001-foundation.sql", import.meta.url), "utf8");
const domainSql = fs.readFileSync(new URL("./migrations/0002-domain.sql", import.meta.url), "utf8");
const localClientsSql = fs.readFileSync(new URL("./migrations/0003-local-clients.sql", import.meta.url), "utf8");
const seriesSql = fs.readFileSync(new URL("./migrations/0004-series.sql", import.meta.url), "utf8");
const seriesEntriesSql = fs.readFileSync(new URL("./migrations/0005-series-entries.sql", import.meta.url), "utf8");
const wikiSql = fs.readFileSync(new URL("./migrations/0006-wiki.sql", import.meta.url), "utf8");
const sourceKindSql = fs.readFileSync(new URL("./migrations/0007-source-kind.sql", import.meta.url), "utf8");
const sourceIngestsSql = fs.readFileSync(new URL("./migrations/0008-source-ingests.sql", import.meta.url), "utf8");
const wikiEvidenceSql = fs.readFileSync(new URL("./migrations/0009-wiki-evidence.sql", import.meta.url), "utf8");
const contentBridgeIntegritySql = fs.readFileSync(new URL("./migrations/0012-content-bridge-integrity.sql", import.meta.url), "utf8");
const llmWikiPagesSql = fs.readFileSync(new URL("./migrations/0010-llm-wiki-pages.sql", import.meta.url), "utf8");
const contentBridgeSql = fs.readFileSync(new URL("./migrations/0011-content-bridge.sql", import.meta.url), "utf8");
const audienceProblemOriginSql = fs.readFileSync(new URL("./migrations/0013-audience-problem-origin.sql", import.meta.url), "utf8");
const contentExperimentsSql = fs.readFileSync(new URL("./migrations/0014-content-experiments.sql", import.meta.url), "utf8");
const audienceRawSourcesSql = fs.readFileSync(new URL("./migrations/0015-audience-raw-sources.sql", import.meta.url), "utf8");
const audienceProblemMultiQuoteSql = fs.readFileSync(new URL("./migrations/0016-audience-problem-multi-quote.sql", import.meta.url), "utf8");

const projectNotebooksSql = fs.readFileSync(new URL("./migrations/0017-project-notebooks.sql", import.meta.url), "utf8");
const projectNotebookRequestKeySql = fs.readFileSync(new URL("./migrations/0018-project-notebook-request-key.sql", import.meta.url), "utf8");

const researchSql = fs.readFileSync(new URL("./migrations/0019-research.sql", import.meta.url), "utf8");

const experienceSql = fs.readFileSync(new URL("./migrations/0020-workspace-experience.sql", import.meta.url), "utf8");

const intelligenceSql = fs.readFileSync(new URL("./migrations/0021-intelligence.sql", import.meta.url), "utf8");

const intelligenceFeedSql = fs.readFileSync(new URL("./migrations/0022-intelligence-feed.sql", import.meta.url), "utf8");

const intelligenceDirectionsSql = fs.readFileSync(new URL("./migrations/0023-intelligence-directions.sql", import.meta.url), "utf8");

const intelDirectionDismissedSql = fs.readFileSync(new URL("./migrations/0024-intel-direction-dismissed.sql", import.meta.url), "utf8");

const personalAssetsSql = fs.readFileSync(new URL("./migrations/0025-personal-assets.sql", import.meta.url), "utf8");

const noteInsightsSql = fs.readFileSync(new URL("./migrations/0026-note-insights-intake.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const intelligenceV2Sql = fs.readFileSync(new URL('./migrations/0027-intelligence-v2.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const intelligenceChannelsSql = fs.readFileSync(new URL('./migrations/0028-intelligence-channels.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

export const WORKSPACE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "foundation",
    sql: foundationSql,
    checksum: crypto.createHash("sha256").update(foundationSql).digest("hex"),
  }),
  Object.freeze({
    version: 2,
    name: "domain",
    sql: domainSql,
    checksum: crypto.createHash("sha256").update(domainSql).digest("hex"),
  }),
  Object.freeze({
    version: 3,
    name: "local-clients",
    sql: localClientsSql,
    checksum: crypto.createHash("sha256").update(localClientsSql).digest("hex"),
  }),
  Object.freeze({
    version: 4,
    name: "content-series",
    sql: seriesSql,
    checksum: crypto.createHash("sha256").update(seriesSql).digest("hex"),
  }),
  Object.freeze({
    version: 5,
    name: "series-entries",
    sql: seriesEntriesSql,
    checksum: crypto.createHash("sha256").update(seriesEntriesSql).digest("hex"),
  }),
  Object.freeze({
    version: 6,
    name: "wiki",
    sql: wikiSql,
    checksum: crypto.createHash("sha256").update(wikiSql).digest("hex"),
  }),
  Object.freeze({
    version: 7,
    name: "source-kind",
    sql: sourceKindSql,
    checksum: crypto.createHash("sha256").update(sourceKindSql).digest("hex"),
  }),
  Object.freeze({
    version: 8,
    name: "source-ingests",
    sql: sourceIngestsSql,
    checksum: crypto.createHash("sha256").update(sourceIngestsSql).digest("hex"),
  }),
  Object.freeze({
    version: 9,
    name: "wiki-evidence",
    sql: wikiEvidenceSql,
    checksum: crypto.createHash("sha256").update(wikiEvidenceSql).digest("hex"),
  }),
  Object.freeze({
    version: 10,
    name: "llm-wiki-pages",
    sql: llmWikiPagesSql,
    checksum: crypto.createHash("sha256").update(llmWikiPagesSql).digest("hex"),
  }),
  Object.freeze({
    version: 11,
    name: "content-bridge",
    sql: contentBridgeSql,
    checksum: crypto.createHash("sha256").update(contentBridgeSql).digest("hex"),
  }),
  Object.freeze({
    version: 12,
    name: "content-bridge-integrity",
    sql: contentBridgeIntegritySql,
    checksum: crypto.createHash("sha256").update(contentBridgeIntegritySql).digest("hex"),
  }),
  Object.freeze({
    version: 13,
    name: "audience-problem-origin",
    sql: audienceProblemOriginSql,
    checksum: crypto.createHash("sha256").update(audienceProblemOriginSql).digest("hex"),
  }),
  Object.freeze({
    version: 14,
    name: "content-experiments",
    sql: contentExperimentsSql,
    checksum: crypto.createHash("sha256").update(contentExperimentsSql).digest("hex"),
  }),
  Object.freeze({
    version: 15,
    name: "audience-raw-sources",
    sql: audienceRawSourcesSql,
    checksum: crypto.createHash("sha256").update(audienceRawSourcesSql).digest("hex"),
  }),
  Object.freeze({
    version: 16,
    name: "audience-problem-multi-quote",
    sql: audienceProblemMultiQuoteSql,
    checksum: crypto.createHash("sha256").update(audienceProblemMultiQuoteSql).digest("hex"),
  }),
  Object.freeze({
    version: 17,
    name: "project-notebooks",
    sql: projectNotebooksSql,
    checksum: crypto.createHash("sha256").update(projectNotebooksSql).digest("hex"),
  }),
  Object.freeze({
    version: 18,
    name: "project-notebook-request-key",
    sql: projectNotebookRequestKeySql,
    checksum: crypto.createHash("sha256").update(projectNotebookRequestKeySql).digest("hex"),
  }),
  Object.freeze({ version: 19, name: "research", sql: researchSql, checksum: crypto.createHash("sha256").update(researchSql).digest("hex") }),
  Object.freeze({ version: 20, name: "workspace-experience", sql: experienceSql, checksum: crypto.createHash("sha256").update(experienceSql).digest("hex") }),
  Object.freeze({ version: 21, name: "intelligence", sql: intelligenceSql, checksum: crypto.createHash("sha256").update(intelligenceSql).digest("hex") }),
  Object.freeze({ version: 22, name: "intelligence-feed", sql: intelligenceFeedSql, checksum: crypto.createHash("sha256").update(intelligenceFeedSql).digest("hex") }),
  Object.freeze({ version: 23, name: "intelligence-directions", sql: intelligenceDirectionsSql, checksum: crypto.createHash("sha256").update(intelligenceDirectionsSql).digest("hex") }),
  Object.freeze({ version: 24, name: "intel-direction-dismissed", sql: intelDirectionDismissedSql, checksum: crypto.createHash("sha256").update(intelDirectionDismissedSql).digest("hex") }),
  Object.freeze({ version: 25, name: "personal-assets", sql: personalAssetsSql, checksum: crypto.createHash("sha256").update(personalAssetsSql).digest("hex") }),
  Object.freeze({ version: 26, name: "note-insights-intake", sql: noteInsightsSql, checksum: crypto.createHash("sha256").update(noteInsightsSql).digest("hex") }),
  Object.freeze({ version: 27, name: 'intelligence-v2', sql: intelligenceV2Sql, checksum: crypto.createHash('sha256').update(intelligenceV2Sql).digest('hex') }),
  Object.freeze({ version: 28, name: 'intelligence-channels', sql: intelligenceChannelsSql, checksum: crypto.createHash('sha256').update(intelligenceChannelsSql).digest('hex') }),
]);

export const WORKSPACE_SCHEMA_VERSION = WORKSPACE_MIGRATIONS.at(-1)?.version || 0;
