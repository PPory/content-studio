// 老版 `.xls`（BIFF8）读成和 `readSheet` 一样的格子。
//
// **为什么非写不可**：公众号后台**只有单篇导出**，而它给的就是这个格式——
// 一个 OLE2 复合文档里装着一条 BIFF 记录流。没有它，公众号的数据一条都进不来。
//
// ⚠️ **这类解析器错了不会报错，只会给出看着正常的错数字**，所以三条自保：
//  1. **只认这份格式真的用到的记录**（LABEL / NUMBER / RK / MULRK / BLANK / 简单 SST）。
//     碰到没把握的（跨记录拆分的共享字符串）**当场抛错并给下一步**，
//     绝不「尽力而为地猜一个」——猜错的样子和读对了一模一样。
//  2. **流在 mini-FAT 里就直接抛错**。小于 4096 字节的流存在另一条链上，
//     按主 FAT 去读会读到隔壁的字节：不报错，只是整张表变成乱码或空白。
//  3. 调用方还有一层交叉验算（见 `wechatArticle` 的「按日相加要等于总阅读」）。

const FREE = 0xfffffffa; // 大于它的都是终止符/特殊值，不是扇区号

/** OLE2 容器：把某个具名流的字节取出来。 */
function readStream(buf, wanted) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0) throw new Error("不是 OLE2 复合文档");
  const ssz = 1 << buf.readUInt16LE(30);
  const cutoff = buf.readUInt32LE(56); // 小于它的流住在 mini-FAT 里
  const sect = (i) => buf.subarray(512 + i * ssz, 512 + (i + 1) * ssz);

  // FAT：前 109 个扇区号写在头里，再多的挂在 DIFAT 链上
  const fatSects = [];
  for (let i = 0; i < 109; i++) {
    const v = buf.readUInt32LE(76 + i * 4);
    if (v <= FREE) fatSects.push(v);
  }
  let dif = buf.readUInt32LE(68);
  for (let n = buf.readUInt32LE(72); n > 0 && dif <= FREE; n--) {
    const s = sect(dif);
    for (let i = 0; i < ssz / 4 - 1; i++) {
      const v = s.readUInt32LE(i * 4);
      if (v <= FREE) fatSects.push(v);
    }
    dif = s.readUInt32LE(ssz - 4);
  }
  const fat = [];
  for (const f of fatSects) {
    const s = sect(f);
    for (let i = 0; i < ssz / 4; i++) fat.push(s.readUInt32LE(i * 4));
  }
  // ⚠️ 链上加一个上限：文件坏掉时 FAT 可能自己指回自己，没有上限就是死循环
  const chain = (start) => {
    const out = [];
    for (let c = start; c <= FREE && out.length < 100000; c = fat[c]) out.push(c);
    return out;
  };

  const dir = Buffer.concat(chain(buf.readUInt32LE(48)).map(sect));
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = dir.readUInt16LE(o + 64);
    if (!nameLen) continue;
    const name = dir.subarray(o, o + nameLen).toString("utf16le").replace(/\0/g, "");
    if (name !== wanted) continue;
    const size = dir.readUInt32LE(o + 120);
    if (size < cutoff) {
      throw Object.assign(new Error("这份 .xls 的数据存在 mini-FAT 里，还读不了"), {
        hint: "在 Excel 里另存为 .xlsx 再导入",
      });
    }
    return Buffer.concat(chain(dir.readUInt32LE(o + 116)).map(sect)).subarray(0, size);
  }
  throw new Error(`这份 .xls 里没找到「${wanted}」流`);
}

/** RK 值：低两位是标志位，其余 30 位要么是整数、要么是 double 的高位。 */
function rkValue(n) {
  let v;
  if (n & 2) {
    v = n >> 2; // 有符号整数
  } else {
    const b = Buffer.alloc(8);
    b.writeInt32LE(n & 0xfffffffc, 4);
    v = b.readDoubleLE(0);
  }
  return n & 1 ? v / 100 : v;
}

/** BIFF8 里的字符串：cch(2) + grbit(1) + 正文，grbit 的 bit0 决定宽窄。 */
function biffString(b, at) {
  const cch = b.readUInt16LE(at);
  const flags = b[at + 2];
  const wide = flags & 1;
  const bytes = cch * (wide ? 2 : 1);
  const body = b.subarray(at + 3, at + 3 + bytes);
  return wide ? body.toString("utf16le") : body.toString("latin1");
}

/**
 * `.xls` → 一个二维数组（`grid[行][列]`），空格子是空串。
 * 和 `readXlsx` 的产出形状一致，好让上层一视同仁。
 */
export function readXls(bytes) {
  const w = readStream(Buffer.from(bytes), "Workbook");
  const cells = new Map();
  const put = (r, c, v) => {
    if (!cells.has(r)) cells.set(r, []);
    cells.get(r)[c] = v;
  };
  const sst = [];
  let maxCol = 0;
  let p = 0;
  while (p + 4 <= w.length) {
    const id = w.readUInt16LE(p);
    const len = w.readUInt16LE(p + 2);
    if (p + 4 + len > w.length) break;
    const d = w.subarray(p + 4, p + 4 + len);
    p += 4 + len;

    if (id === 0x00fc) {
      // 共享字符串表。**拆到 CONTINUE 里的不猜**：接续记录会重新给一个 grbit，
      // 处理错了得到的是错位的文本，而且一个字都不会报错。
      let o = 8;
      const total = d.readUInt32LE(4);
      for (let i = 0; i < total; i++) {
        if (o + 3 > d.length) {
          throw Object.assign(new Error("这份 .xls 的共享字符串表跨记录拆开了，还读不了"), {
            hint: "在 Excel 里另存为 .xlsx 再导入",
          });
        }
        const cch = d.readUInt16LE(o);
        const flags = d[o + 2];
        o += 3;
        let rt = 0;
        let sz = 0;
        if (flags & 8) { rt = d.readUInt16LE(o); o += 2; }
        if (flags & 4) { sz = d.readUInt32LE(o); o += 4; }
        const bytes2 = cch * (flags & 1 ? 2 : 1);
        sst.push(flags & 1 ? d.subarray(o, o + bytes2).toString("utf16le") : d.subarray(o, o + bytes2).toString("latin1"));
        o += bytes2 + rt * 4 + sz;
      }
      continue;
    }

    let row = -1;
    let col = -1;
    if (id === 0x0204 || id === 0x00fd || id === 0x0203 || id === 0x027e || id === 0x0201 || id === 0x00bd) {
      row = d.readUInt16LE(0);
      col = d.readUInt16LE(2);
    }
    if (id === 0x0204) put(row, col, biffString(d, 6));
    else if (id === 0x00fd) put(row, col, sst[d.readUInt32LE(6)] ?? "");
    else if (id === 0x0203) put(row, col, d.readDoubleLE(6));
    else if (id === 0x027e) put(row, col, rkValue(d.readInt32LE(6)));
    else if (id === 0x0201) put(row, col, "");
    else if (id === 0x00bd) {
      // MULRK：一条记录里连着好几个 RK，末尾两字节是最后一列的列号
      for (let i = 4, c = col; i + 6 <= len - 2; i += 6, c++) put(row, c, rkValue(d.readInt32LE(i + 2)));
    }
    if (col > maxCol) maxCol = col;
  }

  const out = [];
  for (const r of [...cells.keys()].sort((a, b) => a - b)) {
    const line = cells.get(r);
    for (let i = 0; i <= maxCol; i++) if (line[i] == null) line[i] = "";
    out.push(line.map((v) => (typeof v === "number" ? String(v) : String(v ?? ""))));
  }
  return out;
}
