/**
 * 「发展这条」的一次性交接，以及构造过程中那份**还没保存的工作**。
 *
 * 一条连接候选是一个对象（问题 + 证据 + 知识锚点 + 判断），塞不进 `#/库/状态`
 * 两段式的 hash，而它又**不该先落库**——落库正是这次重构要去掉的那一步。
 * 所以走内存里的变量：发现页放下，构造页取用。
 *
 * ⚠️ **构造会话和交接绑在一起。** 用户在构造页选了一条讲法、又用自然语言推了两轮，
 * 这些都还没保存；他去看一眼完整分析再回来，那两轮不该消失。
 * 所以会话活到「换一条连接」或「刷新」为止——换连接时由 `setDiscoveryHandoff` 清掉，
 * 刷新时随页面一起没，这两条都是对的：那时它已经不是「刚才在推的那一条」了。
 *
 * ⚠️ **不进 localStorage。** 它的寿命就是这一次工作；存起来只会让下次打开工作台
 * 莫名其妙弹出一条没人记得的候选。
 */

let pending = null;
let session = null;
/**
 * 下一次扫描要往哪儿看。
 *
 * ⚠️ 复盘学到的东西如果只留在那条实验里，闭环就停在「我知道了」。
 * 把它带成下一次 Discovery 的 focus，学到的判断才真的影响下一篇看哪里。
 */
let focus = "";

export function setDiscoveryHandoff(value) {
  pending = value || null;
  // 换了连接，上一条的构造过程就作废了——留着只会张冠李戴。
  session = null;
}

export function takeDiscoveryHandoff() {
  const value = pending;
  pending = null;
  return value;
}

export function peekDiscoveryHandoff() {
  return pending;
}

export function setConstructionSession(value) {
  session = value || null;
}

export function peekConstructionSession() {
  return session;
}

export function setDiscoveryFocus(value) {
  focus = String(value || "").trim().slice(0, 500);
}

export function takeDiscoveryFocus() {
  const value = focus;
  focus = "";
  return value;
}
