import crypto from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_TIME = 0xffffffffffff;

function encode(value, length) {
  let current = BigInt(value);
  let output = "";
  for (let index = 0; index < length; index++) {
    output = CROCKFORD[Number(current & 31n)] + output;
    current >>= 5n;
  }
  return output;
}

export function createUlid(now = Date.now(), randomBytes = crypto.randomBytes(10)) {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIME) {
    throw new RangeError("ULID 时间必须是有效的 48 位毫秒时间戳");
  }
  if (!Buffer.isBuffer(randomBytes) || randomBytes.length !== 10) {
    throw new TypeError("ULID 随机部分必须是 10 字节 Buffer");
  }
  const random = BigInt(`0x${randomBytes.toString("hex")}`);
  return `${encode(BigInt(now), 10)}${encode(random, 16)}`;
}

export function isUlid(value) {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(String(value || ""));
}
