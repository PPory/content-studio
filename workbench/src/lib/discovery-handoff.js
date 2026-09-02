/**
 * 「发展这条」的一次性交接。
 *
 * 一条连接候选是一个对象（问题 + 证据 + 知识锚点 + 判断），塞不进 `#/库/状态`
 * 两段式的 hash，而它又**不该先落库**——落库正是这次重构要去掉的那一步。
 * 所以走内存里的一次性变量：Discovery 放下，手动工作台取走一次就清掉。
 *
 * 和 `open-target.js` 同一套约束：一次性、不进 localStorage
 * （它的寿命是「这一次跳转」，存起来只会让下次打开工作台莫名其妙弹出一条候选）。
 */

let pending = null;

export function setDiscoveryHandoff(value) {
  pending = value || null;
}

export function takeDiscoveryHandoff() {
  const value = pending;
  pending = null;
  return value;
}

export function peekDiscoveryHandoff() {
  return pending;
}
