export const XENHO_QUALITY_NINE = Object.freeze([
  { id: "audience", question: "写给谁？", intent: "目标读者是否具体，能否看出为什么这篇与他有关。" },
  { id: "real-problem", question: "困境真不真？", intent: "是不是从读者正在经历的真实问题进入，而不是自说自话。" },
  { id: "one-thing", question: "是否只说一件事？", intent: "全文能否用一句核心判断贯穿，旁枝有没有抢走主线。" },
  { id: "change", question: "是否完成一次认知改变？", intent: "读完后，读者的理解、判断或行动是否发生清晰变化。" },
  { id: "depth", question: "道理讲透了吗？", intent: "关键因果有没有跳步，反例、条件和边界有没有交代。" },
  { id: "evidence", question: "证据站得住吗？", intent: "案例、数据、故事和引语是否真的支持对应观点。" },
  { id: "flow", question: "结构顺着思考走吗？", intent: "段落顺序是否帮助读者一步步抵达结论。" },
  { id: "takeaway", question: "读者能带走什么？", intent: "结尾是否留下可复述的判断或可执行的下一步。" },
  { id: "misread", question: "会不会被误读？", intent: "绝对化、标签化和缺少限定的表达是否可能造成错误理解。" },
]);

export function qualityNinePrompt() {
  return XENHO_QUALITY_NINE.map((item, index) => `${index + 1}. ${item.question} ${item.intent}`).join("\n");
}
