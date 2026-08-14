#!/usr/bin/env node
// 把品牌标记（三圆角 + 右下直角的块 + 白色 X）光栅化成 Windows 用的多尺寸 .ico。
//
// 为什么自己画而不是找个 svg→ico 的包：形状是一个圆和一个方块的并集，X 是一条全直线的
// 多边形（原 SVG 里没有一段曲线），两样都是十几行数学。为这个引一个带原生依赖的
// 光栅化库，装的时间比画的时间长。
//
// 颜色和 index.html 的 favicon 保持一致（近黑 #111318 + 纯白 X）：浏览器标签页和任务栏
// 都没有主题 token，这里就是写死的黑底白字。
//
//   node scripts/make-icon.mjs        → scripts/xenho-os.ico

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "xenho-os.ico");

// ── 形状（坐标取自 logo-X字母黑底白色-20260812.svg，viewBox 0.92 0 299.24 299.24）
const CX = 150.52;
const CY = 149.61;
const R = 149.61;
const BOX = { x0: 0.917969, y0: 0, w: 299.234375, h: 299.238281 };

// X 字形：原 path 全是 L 指令，直接当多边形用。translate(79.471746, 226.479901) 已合进来。
const TX = 79.471746;
const TY = 226.479901;
// prettier-ignore
const GLYPH = [
  [146.296875, 0], [103.578125, 0], [69.28125, -49.40625], [35, 0], [-5.984375, 0],
  [48.890625, -78.078125], [3.171875, -145.078125], [42.546875, -145.078125],
  [69.28125, -105.5], [96.015625, -145.078125], [137.15625, -145.078125], [89.6875, -78.078125],
].map(([x, y]) => [x + TX, y + TY]);

const BG = [0x11, 0x13, 0x18];
const FG = [0xff, 0xff, 0xff];

const PAD = 0.04; // 图标四周留一点气口，铺满到边在任务栏上会显得比邻居大一圈
const SS = 4; // 每边 4 倍超采样做抗锯齿

function inShape(x, y) {
  const dx = x - CX;
  const dy = y - CY;
  if (dx * dx + dy * dy <= R * R) return true;
  // 右下那个直角象限
  return x >= CX && x <= CX + R && y >= CY && y <= CY + R;
}

function inGlyph(x, y) {
  // 射线法。多边形是简单闭合的，nonzero 和 even-odd 结果一致。
  let inside = false;
  for (let i = 0, j = GLYPH.length - 1; i < GLYPH.length; j = i++) {
    const [xi, yi] = GLYPH[i];
    const [xj, yj] = GLYPH[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 渲染一张 size×size 的 RGBA 位图 */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (pxi * SS + sx + 0.5) * step;
          const v = (py * SS + sy + 0.5) * step;
          // 去掉边距后映射回 logo 坐标
          const uu = (u - PAD) / (1 - 2 * PAD);
          const vv = (v - PAD) / (1 - 2 * PAD);
          if (uu < 0 || uu > 1 || vv < 0 || vv > 1) continue;
          const lx = BOX.x0 + uu * BOX.w;
          const ly = BOX.y0 + vv * BOX.h;
          if (!inShape(lx, ly)) continue;
          bg++;
          if (inGlyph(lx, ly)) fg++;
        }
      }
      const total = SS * SS;
      const o = (py * size + pxi) * 4;
      if (!bg) continue; // 全透明
      const a = bg / total;
      const fa = fg / total;
      // 先按覆盖率算预乘色，再除以 alpha 还原（fg 恒在 bg 内部，所以 fa <= a）
      for (let c = 0; c < 3; c++) {
        const premul = (BG[c] / 255) * (a - fa) + (FG[c] / 255) * fa;
        px[o + c] = Math.round((premul / a) * 255);
      }
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// ── PNG 编码（8bit RGBA，无滤波）
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── BMP（DIB）编码：BGRA 自下而上 + 一张 1bit AND 掩码
//
// ⚠️ 为什么不能所有尺寸都用 PNG：Explorer 从 Vista 起就认 PNG 帧，但 .NET 的
// System.Drawing.Icon 到今天都不认——`new Icon(path, 64, 64).ToBitmap()` 会抛
// 「Requested range extends past the end of the array」。启动画面要显示这个图标，
// 踩过一次，而且因为脚本是隐藏跑的，报错谁都看不见。
// 所以按常规布局来：小尺寸 BMP（谁都认），大尺寸 PNG（BMP 到 256 就是 256KB 一张）。
function toBmp(size, rgba) {
  const rowXor = size * 4;
  const rowAnd = Math.ceil(size / 32) * 4; // AND 掩码每行按 4 字节对齐
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(size, 4);
  head.writeInt32LE(size * 2, 8); // 高度要写两倍：XOR 位图 + AND 掩码
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  head.writeUInt32LE(0, 16); // BI_RGB
  head.writeUInt32LE(rowXor * size + rowAnd * size, 20);

  const xor = Buffer.alloc(rowXor * size);
  const and = Buffer.alloc(rowAnd * size);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y; // BMP 是自下而上的
    for (let x = 0; x < size; x++) {
      const s = (srcY * size + x) * 4;
      const d = y * rowXor + x * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
      // 32 位图标其实按 alpha 通道合成，但掩码写对了不吃亏（老代码路径还看它）
      if (rgba[s + 3] === 0) and[y * rowAnd + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([head, xor, and]);
}

// ── ICO 容器
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map((s) => {
  const rgba = render(s);
  return s >= 128 ? toPng(s, rgba) : toBmp(s, rgba);
});

// 启动画面（WinForms）单独用一张 PNG 更省事，顺手出一张
writeFileSync(OUT.replace(/\.ico$/, "-64.png"), toPng(64, render(64)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);

let offset = 6 + SIZES.length * 16;
const entries = SIZES.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; // 256 在这个字段里写 0
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});

writeFileSync(OUT, Buffer.concat([header, ...entries, ...images]));
console.log(`icon → ${OUT}  (${SIZES.join("/")}, ${(offset / 1024).toFixed(1)} KB)`);
