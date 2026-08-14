#!/usr/bin/env node
/**
 * Two-stage web research for Personal Intelligence Radar.
 *
 * Stage 1: Brave Search discovers candidate URLs.
 * Stage 2: Firecrawl extracts only the URLs selected by the analyst/agent.
 *
 * Network calls are opt-in: without --go the script prints a dry-run plan.
 * No third-party npm packages are required.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 172800000;
const VALID_PURPOSES = new Set(["support", "counter", "supply"]);
const HTTP_RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function usage() {
  console.log(`
Personal Intelligence Radar web research

Search with Brave (dry run by default):
  node scripts/web_research.mjs search \\
    --queue tmp/insight-work/2026-W33/verification-queue.json \\
    --output tmp/insight-work/2026-W33/web

  # Add --go to make network requests.

Fetch selected pages with Firecrawl (dry run by default):
  node scripts/web_research.mjs fetch \\
    --plan tmp/insight-work/2026-W33/web/fetch-plan.json \\
    --output tmp/insight-work/2026-W33/web

Options:
  --go                  Execute requests; otherwise print the plan only.
  --only <claim-id>     Restrict to one claim.
  --project-root <dir>  Project root containing .env (default: cwd).
  --env-file <path>     Explicit env file.
  --max-pages <N>       Safety cap for Firecrawl pages (default: 20).

Environment variables:
  BRAVE_SEARCH_API_KEY
  FIRECRAWL_API_KEY
  BRAVE_SEARCH_API_BASE       Optional endpoint override for testing/proxying.
  FIRECRAWL_API_BASE          Optional endpoint override for testing/proxying.
`);
}

function parseCli(argv) {
  const command = argv[0] || "";
  const args = argv.slice(1);
  const has = (flag) => args.includes(flag);
  const value = (flag, fallback = "") => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const integer = (flag, fallback) => {
    const raw = value(flag);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
  };

  return {
    command,
    go: has("--go"),
    queue: value("--queue"),
    plan: value("--plan"),
    output: value("--output"),
    only: value("--only"),
    projectRoot: value("--project-root", process.cwd()),
    envFile: value("--env-file"),
    maxPages: integer("--max-pages", 20),
  };
}

function die(message, hint = "") {
  console.error(`ERROR: ${message}`);
  if (hint) console.error(`  Hint: ${hint}`);
  process.exitCode = 1;
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${filePath}: ${error.message}`);
  }
}

function parseDotEnv(text) {
  const result = {};
  for (const original of text.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equal = normalized.indexOf("=");
    if (equal <= 0) continue;
    const key = normalized.slice(0, equal).trim();
    let value = normalized.slice(equal + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function loadEnvironment(projectRoot, explicitEnvFile) {
  const envPath = explicitEnvFile
    ? path.resolve(explicitEnvFile)
    : path.resolve(projectRoot, ".env");
  let fileEnv = {};
  try {
    fileEnv = parseDotEnv(await fs.readFile(envPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...fileEnv, ...process.env };
}

async function resolveFetch(projectRoot) {
  // The user's creator-workbench already provides proxyFetch for unstable networks.
  // Prefer it when available; keep a global-fetch fallback for portability and tests.
  const proxyPath = path.resolve(projectRoot, "server/lib/fetch.mjs");
  try {
    const module = await import(pathToFileURL(proxyPath).href);
    if (typeof module.proxyFetch === "function") return module.proxyFetch;
  } catch {
    // Fall through intentionally.
  }
  if (typeof globalThis.fetch !== "function") {
    throw new Error("no fetch implementation available");
  }
  return globalThis.fetch.bind(globalThis);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(8000, 700 * 2 ** attempt);
}

async function requestJson(fetchImpl, url, options, label, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`${label} HTTP ${response.status}: ${text.slice(0, 500)}`);
        if (!HTTP_RETRY_STATUSES.has(response.status) || attempt + 1 >= attempts) throw error;
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${label} returned non-JSON: ${text.slice(0, 500)}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await sleep(Math.min(8000, 700 * 2 ** attempt));
    }
  }
  throw lastError || new Error(`${label} failed`);
}

function normalizeUrl(raw) {
  const parsed = new URL(raw);
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`unsupported URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) throw new Error("URLs with embedded credentials are not allowed");
  parsed.hash = "";
  return parsed.toString();
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^169\.254\./.test(host) || /^0\./.test(host)) return true;
  return false;
}

function safePublicUrl(raw) {
  const normalized = normalizeUrl(raw);
  const parsed = new URL(normalized);
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`private/local URL is not allowed: ${parsed.hostname}`);
  }
  return normalized;
}

function isoNow() {
  return new Date().toISOString();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function safeFileStem(url, index) {
  let host = "page";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Keep fallback.
  }
  const compactHost = host.replace(/[^a-zA-Z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${String(index).padStart(3, "0")}-${compactHost.slice(0, 45)}-${sha256(url).slice(0, 10)}`;
}

function validateQueue(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.claims)) {
    throw new Error("verification queue must contain a claims array");
  }
  const queryIds = new Set();
  const claimIds = new Set();
  for (const claim of data.claims) {
    if (!claim || typeof claim !== "object") throw new Error("each claim must be an object");
    if (!claim.claim_id || !claim.candidate_id || !claim.claim) {
      throw new Error("each claim needs claim_id, candidate_id, and claim");
    }
    if (claimIds.has(claim.claim_id)) throw new Error(`duplicate claim_id: ${claim.claim_id}`);
    claimIds.add(claim.claim_id);
    if (!Array.isArray(claim.queries) || !claim.queries.length) {
      throw new Error(`${claim.claim_id} needs at least one query`);
    }
    for (const query of claim.queries) {
      if (!query.query_id || !query.q || !query.purpose) {
        throw new Error(`${claim.claim_id} query needs query_id, q, and purpose`);
      }
      if (!VALID_PURPOSES.has(query.purpose)) {
        throw new Error(`${query.query_id} purpose must be support, counter, or supply`);
      }
      if (queryIds.has(query.query_id)) throw new Error(`duplicate query_id: ${query.query_id}`);
      queryIds.add(query.query_id);
      const count = query.count ?? 8;
      if (!Number.isInteger(count) || count < 1 || count > 20) {
        throw new Error(`${query.query_id} count must be an integer from 1 to 20`);
      }
    }
  }
}

function validateFetchPlan(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.pages)) {
    throw new Error("fetch plan must contain a pages array");
  }
  for (const page of data.pages) {
    if (!page || typeof page !== "object") throw new Error("each page must be an object");
    if (!page.claim_id || !page.url || !page.purpose || !page.source_role) {
      throw new Error("each page needs claim_id, url, purpose, and source_role");
    }
    if (!VALID_PURPOSES.has(page.purpose)) {
      throw new Error(`${page.claim_id} page purpose must be support, counter, or supply`);
    }
    safePublicUrl(page.url);
  }
}

function flattenQueries(queue, onlyClaim) {
  const rows = [];
  for (const claim of queue.claims) {
    if (onlyClaim && claim.claim_id !== onlyClaim) continue;
    for (const query of claim.queries) {
      rows.push({
        week: queue.week || "",
        claim_id: claim.claim_id,
        candidate_id: claim.candidate_id,
        claim: claim.claim,
        claim_type: claim.claim_type || "",
        load_bearing: Boolean(claim.load_bearing),
        tier: claim.tier ?? null,
        ...query,
      });
    }
  }
  return rows;
}

function normalizeBraveResults(payload, queryRow) {
  const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return results.map((item, index) => ({
    rank: index + 1,
    title: item.title || "",
    url: item.url || "",
    description: item.description || "",
    extra_snippets: Array.isArray(item.extra_snippets) ? item.extra_snippets : [],
    age: item.age || "",
    language: item.language || "",
    family_friendly: item.family_friendly ?? null,
    profile: item.profile || null,
    query_id: queryRow.query_id,
    claim_id: queryRow.claim_id,
    candidate_id: queryRow.candidate_id,
    purpose: queryRow.purpose,
  }));
}

async function braveSearch(fetchImpl, endpoint, key, row) {
  const params = new URLSearchParams({
    q: row.q,
    count: String(row.count ?? 8),
    result_filter: "web",
    extra_snippets: "true",
    spellcheck: "true",
  });
  if (row.country) params.set("country", row.country);
  if (row.search_lang) params.set("search_lang", row.search_lang);
  if (row.ui_lang) params.set("ui_lang", row.ui_lang);
  if (row.freshness) params.set("freshness", row.freshness);
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${endpoint}${separator}${params.toString()}`;
  const payload = await requestJson(
    fetchImpl,
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
    },
    `Brave query ${row.query_id}`
  );
  return normalizeBraveResults(payload, row);
}

async function firecrawlScrape(fetchImpl, endpoint, key, page) {
  const maxAge = Number.isFinite(page.max_age_ms)
    ? Math.max(0, Number(page.max_age_ms))
    : DEFAULT_FIRECRAWL_MAX_AGE_MS;
  const payload = await requestJson(
    fetchImpl,
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: page.url,
        formats: ["markdown"],
        onlyMainContent: true,
        maxAge,
        removeBase64Images: true,
        blockAds: true,
        storeInCache: page.store_in_cache ?? true,
        timeout: page.timeout_ms ?? 60000,
      }),
    },
    `Firecrawl ${page.url}`
  );
  if (!payload?.success || !payload?.data) {
    throw new Error(`Firecrawl returned an unsuccessful response for ${page.url}`);
  }
  const markdown = payload.data.markdown || "";
  return {
    markdown,
    metadata: payload.data.metadata || {},
    warning: payload.warning || "",
  };
}

async function runSearch(options, env, fetchImpl) {
  if (!options.queue) throw new Error("search requires --queue");
  if (!options.output) throw new Error("search requires --output");
  const queuePath = path.resolve(options.queue);
  const output = path.resolve(options.output);
  const queue = await readJson(queuePath);
  validateQueue(queue);
  const queries = flattenQueries(queue, options.only);
  if (!queries.length) throw new Error("no matching queries to run");

  const totalRequestedResults = queries.reduce((sum, item) => sum + (item.count ?? 8), 0);
  console.log("\nWeb verification search plan");
  console.log("----------------------------------------");
  for (const query of queries) {
    console.log(`- ${query.query_id} [${query.purpose}] count=${query.count ?? 8}`);
    console.log(`  ${query.q}`);
  }
  console.log("----------------------------------------");
  console.log(`Brave calls: ${queries.length}`);
  console.log(`Maximum returned result rows: ${totalRequestedResults}`);

  if (!options.go) {
    console.log("Dry run only. Add --go to call Brave Search.\n");
    return 0;
  }

  const key = (env.BRAVE_SEARCH_API_KEY || "").trim();
  if (!key) {
    throw new Error("BRAVE_SEARCH_API_KEY is missing");
  }
  const endpoint = (env.BRAVE_SEARCH_API_BASE || DEFAULT_BRAVE_ENDPOINT).trim();
  const records = [];
  const failures = [];

  for (const query of queries) {
    try {
      const results = await braveSearch(fetchImpl, endpoint, key, query);
      records.push({
        query_id: query.query_id,
        claim_id: query.claim_id,
        candidate_id: query.candidate_id,
        claim: query.claim,
        claim_type: query.claim_type,
        load_bearing: query.load_bearing,
        purpose: query.purpose,
        q: query.q,
        parameters: {
          country: query.country || null,
          search_lang: query.search_lang || null,
          ui_lang: query.ui_lang || null,
          freshness: query.freshness || null,
          count: query.count ?? 8,
        },
        retrieved_at: isoNow(),
        results,
      });
      console.log(`OK ${query.query_id}: ${results.length} result(s)`);
    } catch (error) {
      failures.push({ query_id: query.query_id, error: error.message });
      console.error(`FAIL ${query.query_id}: ${error.message}`);
    }
  }

  await fs.mkdir(output, { recursive: true });
  const resultPath = path.join(output, "search-results.json");
  const document = {
    schema_version: 1,
    week: queue.week || "",
    provider: "brave-search",
    generated_at: isoNow(),
    queue_path: queuePath,
    query_count: queries.length,
    successful_queries: records.length,
    failed_queries: failures.length,
    queries: records,
    failures,
  };
  await fs.writeFile(resultPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  console.log(`Search results: ${resultPath}`);
  if (!records.length) return 1;
  return 0;
}

function dedupePages(plan, onlyClaim, maxPages) {
  const byUrl = new Map();
  for (const page of plan.pages) {
    if (onlyClaim && page.claim_id !== onlyClaim) continue;
    const url = safePublicUrl(page.url);
    const key = url;
    if (!byUrl.has(key)) {
      byUrl.set(key, {
        ...page,
        url,
        references: [
          {
            claim_id: page.claim_id,
            query_id: page.query_id || "",
            purpose: page.purpose,
            source_role: page.source_role,
            expected_evidence: page.expected_evidence || "",
          },
        ],
      });
    } else {
      byUrl.get(key).references.push({
        claim_id: page.claim_id,
        query_id: page.query_id || "",
        purpose: page.purpose,
        source_role: page.source_role,
        expected_evidence: page.expected_evidence || "",
      });
    }
  }
  const pages = [...byUrl.values()];
  if (pages.length > maxPages) {
    throw new Error(`fetch plan has ${pages.length} unique URLs; safety cap is ${maxPages}`);
  }
  return pages;
}

async function runFetch(options, env, fetchImpl) {
  if (!options.plan) throw new Error("fetch requires --plan");
  if (!options.output) throw new Error("fetch requires --output");
  const planPath = path.resolve(options.plan);
  const output = path.resolve(options.output);
  const plan = await readJson(planPath);
  validateFetchPlan(plan);
  const pages = dedupePages(plan, options.only, options.maxPages);
  if (!pages.length) throw new Error("no matching pages to fetch");

  console.log("\nWeb page extraction plan");
  console.log("----------------------------------------");
  for (const page of pages) {
    const claimIds = [...new Set(page.references.map((item) => item.claim_id))].join(", ");
    console.log(`- ${claimIds} | ${page.source_role} | ${page.url}`);
  }
  console.log("----------------------------------------");
  console.log(`Firecrawl calls: ${pages.length}`);

  if (!options.go) {
    console.log("Dry run only. Add --go to call Firecrawl.\n");
    return 0;
  }

  const key = (env.FIRECRAWL_API_KEY || "").trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is missing");
  const endpoint = (env.FIRECRAWL_API_BASE || DEFAULT_FIRECRAWL_ENDPOINT).trim();
  const pagesDir = path.join(output, "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  const records = [];
  let successCount = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const baseRecord = {
      url: page.url,
      references: page.references,
      retrieved_at: isoNow(),
    };
    try {
      const scraped = await firecrawlScrape(fetchImpl, endpoint, key, page);
      const stem = safeFileStem(page.url, index + 1);
      const pagePath = path.join(pagesDir, `${stem}.md`);
      const claimIds = [...new Set(page.references.map((item) => item.claim_id))];
      const header = [
        "<!-- PIR_WEB_SOURCE",
        `url: ${page.url}`,
        `claim_ids: ${claimIds.join(", ")}`,
        `source_roles: ${[...new Set(page.references.map((item) => item.source_role))].join(", ")}`,
        `retrieved_at: ${baseRecord.retrieved_at}`,
        `content_policy: Firecrawl markdown extraction; verify quotes against source context`,
        "-->",
        "",
      ].join("\n");
      await fs.writeFile(pagePath, header + scraped.markdown, "utf8");
      records.push({
        ...baseRecord,
        ok: true,
        path: pagePath,
        title: scraped.metadata?.title || "",
        status_code: scraped.metadata?.statusCode ?? null,
        characters: scraped.markdown.length,
        sha256: sha256(scraped.markdown),
        warning: scraped.warning,
      });
      successCount += 1;
      console.log(`OK ${page.url} -> ${pagePath}`);
    } catch (error) {
      records.push({ ...baseRecord, ok: false, error: error.message });
      console.error(`FAIL ${page.url}: ${error.message}`);
    }
  }

  const resultPath = path.join(output, "fetch-results.json");
  const document = {
    schema_version: 1,
    week: plan.week || "",
    provider: "firecrawl",
    generated_at: isoNow(),
    plan_path: planPath,
    unique_url_count: pages.length,
    successful_pages: successCount,
    failed_pages: pages.length - successCount,
    pages: records,
  };
  await fs.writeFile(resultPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  console.log(`Fetch results: ${resultPath}`);
  return successCount ? 0 : 1;
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    die(error.message);
    usage();
    return 1;
  }

  if (!["search", "fetch"].includes(options.command)) {
    usage();
    return options.command ? 1 : 0;
  }

  try {
    const projectRoot = path.resolve(options.projectRoot);
    const env = await loadEnvironment(projectRoot, options.envFile);
    const fetchImpl = await resolveFetch(projectRoot);
    return options.command === "search"
      ? await runSearch(options, env, fetchImpl)
      : await runFetch(options, env, fetchImpl);
  } catch (error) {
    die(error.message);
    return 1;
  }
}

process.exitCode = await main();
