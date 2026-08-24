// 「单篇报告」形态：一份文件讲一篇内容，指标竖着排成「名称 | 数值」两列。
//
// 公众号后台**只有单篇导出**（列表导出不存在），给的就是这个形状：
// 一行标题、一段「数据概况」、一段「阅读转化」，最后一段按日按渠道的明细。
// 通用的 `readSheet` 认的是「第一行表头、下面一行一条」，套在这上面会把
// 「数据指标 / 数值」当成表头、把十几个指标当成十几条内容——**不报错，只是全错**。
//
// ⚠️ **这一层只做形状识别和拍平，不认识任何平台。** 判据是「大多数行是两格、
// 第二格是数字」，不是「文件名里有公众号」。

const isNum = (v) => String(v ?? "").trim() !== "" && !Number.isNaN(Number(v));
const cellsOf = (row) => row.map((v) => String(v ?? "").trim());
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 像不像单篇报告：**只看开头那一段**。
 *
 * ⚠️ **不能拿整份文件算比例。** 这类报告末尾还挂着一张按日按渠道的明细
 * （实测 80 行里 60 行是它），整份算的话「两格指标对」永远是少数派，
 * 检测恒为 false——而失败的样子是**它被当成普通表格读**：
 * 「数据指标 / 数值」成了表头，十几个指标成了十几条内容，一个字都不报错。
 */
export function looksLikeSingleReport(grid) {
  const filled = grid.map(cellsOf).filter((r) => r.some(Boolean));
  if (filled.length < 6) return false;
  const head = filled.slice(0, 20);
  const pairs = head.filter((r) => {
    const v = r.filter(Boolean);
    return v.length === 2 && isNum(v[1]);
  });
  return pairs.length >= 5 && pairs.length * 2 >= head.length;
}

/**
 * 拍平成 `{ headers, rows: [一行] }`，和 `readSheet` 的产出同形状。
 *
 * ⚠️ **「数据概况」的指标要排在前面。** 后面那段「阅读转化」里有
 * 「公众号消息阅读人数」「总分享人数」这种同样带「阅读」「分享」字样的名字，
 * 而列名映射是**从前往后挑第一个匹配的**——顺序反了，`views` 会取到
 * 「公众号消息阅读人数」（这儿是 0），阅读量当场归零而没有任何地方报错。
 */
export function parseSingleReport(grid) {
  const rows = grid.map(cellsOf);
  const out = {};

  // 标题：第一格有字、且那一行只有它一个的，就是它
  for (const r of rows) {
    const v = r.filter(Boolean);
    if (v.length === 1 && !isNum(v[0])) { out["标题"] = v[0]; break; }
    if (v.length) break;
  }

  // 指标对。表头那一行（「数据指标 | 数值」）和分节标题都跳过。
  for (const r of rows) {
    const v = r.filter(Boolean);
    if (v.length === 2 && isNum(v[1]) && !(v[0] in out)) out[v[0]] = v[1];
  }

  /**
   * 发布日期 = 明细里最早的那一天。
   * ⚠️ **这是推断，不是文件里写着的**——所以导入预览必须把它显示出来让人过一眼。
   * 公众号的单篇报告里没有「发布时间」这个字段，而按日明细的第一天就是发出去那天。
   */
  const days = rows.flatMap((r) => r.filter((c) => DATE_RE.test(c))).sort();
  if (days.length) out["发布时间"] = days[0];

  /**
   * ⚠️ **交叉验算：按日相加要等于总数。**
   * 这份文件是二进制解出来的，而这类解析器**错了不会报错、只会给出看着正常的错数字**。
   * 明细里「全部」那几天的阅读人数之和，理应等于概况里的阅读人数（实测 1+9+3+1+1+89=104）。
   * 对不上就说明读串了位——**这是这一整条链上唯一一处能自己发现读错了的地方**。
   * 只回一句提醒不抛错：以后微信加一个不计入「全部」的渠道也会让它对不上，
   * 而那时候拦住整批导入是过度反应。
   */
  const warnings = [];
  const head = rows.find((r) => r.includes("日期") && r.some((c) => c.includes("阅读")));
  if (head) {
    const chanAt = head.findIndex((c) => c.includes("渠道"));
    const readAt = head.findIndex((c) => c.includes("阅读"));
    if (chanAt >= 0 && readAt >= 0) {
      let sum = 0;
      for (const r of rows) if (r[chanAt] === "全部" && isNum(r[readAt])) sum += Number(r[readAt]);
      const totalKey = Object.keys(out).find((k) => k.startsWith("阅读"));
      const total = Number(out[totalKey]);
      if (sum && total && sum !== total) {
        warnings.push(`按日相加是 ${sum}，而概况里写的是 ${total}——这份文件可能没读对，导之前先核一眼`);
      }
    }
  }

  const headers = Object.keys(out);
  return { headers, rows: headers.length ? [out] : [], warnings };
}
