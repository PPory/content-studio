/**
 * 空白页起始句库。
 *
 * 不把两千多句逐条抄进源码：16 个开场 × 16 个惯性动作 × 10 个盲点，组合出 2,560 条。
 * 三组词各自都是完整语义单元，任意组合都能读通；这样扩库只改对应的一组，不会留下
 * 一份谁也不敢维护的巨大字符串清单。
 */
const OPENINGS = [
  "我最近反复想到一个问题：",
  "真正让我停下来的，不是答案，而是：",
  "如果把熟悉的解释先放到一边，",
  "有件小事看起来不重要，却值得追问：",
  "我们都习惯接受一个前提：",
  "我原以为这件事已经想明白了，直到我问：",
  "比结论更有意思的，也许是：",
  "今天不急着给答案，只先问一句：",
  "一个常被略过的细节是：",
  "换个角度看，问题可能不是做得不够，而是：",
  "很多争论卡住，是因为没人先问：",
  "我想从一个不太舒服的问题开始：",
  "表面上这是方法问题，往深一层却是：",
  "真正的分岔口，常常藏在这个问题里：",
  "如果只保留一个值得继续想的问题，那会是：",
  "我越来越怀疑，大家默认正确的那一步其实是：",
];

const HABITS = [
  "追求更快的结果",
  "收集更多的信息",
  "寻找标准答案",
  "把计划排得更满",
  "模仿已经成功的人",
  "用工具替代判断",
  "等准备充分再开始",
  "把复杂问题讲得很简单",
  "努力证明自己是对的",
  "把忙碌当成进展",
  "优先解决最显眼的问题",
  "把不确定性藏起来",
  "重复曾经有效的方法",
  "用更多选择换安全感",
  "急着给经历下结论",
  "把个人感受包装成普遍规律",
];

const BLIND_SPOTS = [
  "它到底在替谁解决什么问题",
  "被省略的代价最后由谁承担",
  "我们真正害怕失去的是什么",
  "这个选择把哪条路悄悄关掉了",
  "看似正确的前提是否还成立",
  "如果反过来做会发生什么",
  "结果变好是否真的来自这一步",
  "那些没有被计算的东西去了哪里",
  "我们是在前进，还是只是在减少焦虑",
  "什么证据会让我们愿意改变看法",
];

export const STARTING_LINE_COUNT = OPENINGS.length * HABITS.length * BLIND_SPOTS.length;

function hash(text) {
  let value = 2166136261;
  for (const char of String(text || "")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** 随机给一句；传 seed 时结果稳定，测试和“按主题换一句”都不用各写一套。 */
export function startingLine({ topic = "", seed = Math.random() } = {}) {
  const raw = typeof seed === "number" ? Math.floor(Math.abs(seed) * 0x7fffffff) : hash(seed);
  const opening = OPENINGS[raw % OPENINGS.length];
  const habit = HABITS[Math.floor(raw / OPENINGS.length) % HABITS.length];
  const blind = BLIND_SPOTS[Math.floor(raw / (OPENINGS.length * HABITS.length)) % BLIND_SPOTS.length];
  const focus = String(topic || "").trim().replace(/[《》“”]/g, "").slice(0, 40);
  return `${focus ? `关于“${focus}”，` : ""}${opening}我们为什么总在${habit}，却很少追问${blind}？`;
}
