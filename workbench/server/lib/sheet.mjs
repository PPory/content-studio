// 把平台后台导出的表格读成「表头 + 一行一个对象」。
//
// 为什么自己写而不是引 SheetJS：xlsx 说到底是个 zip 装着几份 XML，而 zip 我们已经有
// 解析器了（fflate，导 epub 用的）。这里要的只是「读第一张表的单元格文本」——
// 不写公式、不认样式、不管图表。为这点需求引一个几百 KB 的表格库，代价和收益不成比例。
//
// 只在服务端跑，一个字节都不进前端包。

import { unzipSync, strFromU8 } from "fflate";

/**
 * 中文平台的导出常常是 GBK，不是 UTF-8。
 *
 * 判据是**解出来有没有替换字符**（U+FFFD）：UTF-8 解码器遇到非法字节序列会插 �，
 * 而 GBK 的双字节汉字在 UTF-8 里几乎必然非法。反过来拿 GBK 解 UTF-8 不会报错、
 * 只会得到乱码——所以顺序不能反：先试 UTF-8，脏了才退 GBK。
 */
export function decodeText(bytes) {
  const buf = Buffer.from(bytes);
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  try {
    return new TextDecoder("gbk").decode(buf).replace(/^﻿/, "");
  } catch {
    return utf8.replace(/^﻿/, "");
  }
}

/**
 * CSV 全文一遍状态机，不是按行 split。
 *
 * 按行切再解析，遇到引号里包着换行的单元格（导出的标题里换行很常见）就会把一条记录
 * 劈成两条，后面所有列跟着错位——而且错得很安静，界面上只是多出几行没有数字的怪数据。
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim()));
}

const XML_ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const unxml = (s) =>
  String(s).replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, (m, k) =>
    k[0] === "#" ? String.fromCodePoint(Number(k[1] === "x" ? `0${k.slice(1)}` : k.slice(1))) : XML_ENT[k]
  );

// <si> 里可能是一个 <t>，也可能被拆成一串 <r><t>（Excel 给同一格里不同格式的文字分段），
// 全部拼起来才是这一格的文本
const textsIn = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

// "AB12" → 27（0 基列号）。不按出现顺序推，因为空单元格在 XML 里是不写的，
// 按顺序推的话空一格后面所有列都会左移。
function colOf(ref) {
  const letters = /^([A-Z]+)/.exec(ref || "")?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Excel 的日期是「1900 年 1 月 0 日以来的天数」这么个序列号，读出来是 45412 这种数。
 *
 * 那个 `-2` 是 Lotus 1-2-3 传下来的历史包袱（Excel 认为 1900 年有 2 月 29 日，其实没有），
 * 所有电子表格软件都照抄了这个错，所以纪元要取 1899-12-30。
 */
export function excelSerialToDate(n) {
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  return new Date(ms);
}

function readXlsx(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const pick = (re) => Object.keys(files).find((k) => re.test(k));
  const sheetPath = pick(/^xl\/worksheets\/sheet1\.xml$/) || pick(/^xl\/worksheets\/.+\.xml$/);
  if (!sheetPath) throw new Error("这个 xlsx 里没找到工作表");

  const ssPath = pick(/^xl\/sharedStrings\.xml$/);
  const shared = ssPath
    ? [...strFromU8(files[ssPath]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textsIn(m[1]))
    : [];

  const sheet = strFromU8(files[sheetPath]);
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] || "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let v = "";
      if (type === "s") v = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") v = textsIn(inner);
      else if (raw != null) v = unxml(raw);
      const i = colOf(/r="([A-Z]+\d+)"/.exec(attrs)?.[1]);
      if (i >= 0) cells[i] = v;
      else cells.push(v);
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    if (cells.some((v) => String(v).trim())) rows.push(cells);
  }
  return rows;
}

/**
 * 读一份导出文件 → `{ headers, rows }`，rows 是按表头取键的对象。
 *
 * **表头不一定在第一行**：平台导出常常先来两行标题和统计口径说明。所以取「字段数最多、
 * 且看着像表头的那一行」当表头——找错的话后面所有列名都是空的，用户在预览里一眼看得出来。
 */
export function readSheet(bytes, filename = "") {
  const ext = (filename.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase();
  let grid;
  if (ext === ".xlsx" || ext === ".xlsm") grid = readXlsx(bytes);
  else if (ext === ".csv" || ext === ".txt" || ext === "") grid = parseCsv(decodeText(bytes));
  else if (ext === ".xls") throw Object.assign(new Error("老版 .xls 读不了"), { hint: "在 Excel 里另存为 .xlsx 或 .csv 再拖进来" });
  else throw Object.assign(new Error(`不认识 ${ext} 这种文件`), { hint: "支持 .xlsx 和 .csv，平台后台一般两种都能导" });
  if (!grid.length) return { headers: [], rows: [] };

  // 表头行：前 6 行里**互不相同**的非空单元格最多的那行。
  //
  // ⚠️ **判据是「有几个不同的名字」，不是「有几个非空格」。** 平台导出常在第一行放一条
  // 横跨整表的合并横幅（小红书那份是 `A1:M1` 的「最多导出排序后前1000条笔记」），
  // 而**合并单元格在 XML 里是每一格各写一份值**——按非空格数算它 13 分，和真表头打平，
  // 靠前的那行赢。后果不是「表头难看」：13 列全映射到同一个键，下面每行对象**只剩一个字段、
  // 前面的列被后面的覆盖**，整份表安静地塌成一列。表头的定义本来就是每列一个不同的名字。
  const score = (r) => new Set(r.map((v) => String(v ?? "").trim()).filter(Boolean)).size;
  let hi = 0;
  for (let i = 0; i < Math.min(6, grid.length); i++) if (score(grid[i]) > score(grid[hi])) hi = i;
  const headers = grid[hi].map((v) => String(v ?? "").trim());
  const rows = grid.slice(hi + 1).map((cells) => {
    const o = {};
    headers.forEach((h, i) => {
      if (h) o[h] = String(cells[i] ?? "").trim();
    });
    return o;
  });
  return { headers: headers.filter(Boolean), rows };
}
