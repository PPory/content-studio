import { PageHeader } from "../components/ui.jsx";
import { IconArrowRight, IconBooks, IconRadar2, IconSparkles } from "../components/icons.jsx";

const ENTRIES = [
  { view: "hot", icon: IconRadar2, eyebrow: "NOW", title: "热点", desc: "看现在正在发生什么。收藏后才进入你的素材链。", action: "查看今天" },
  { view: "insights", icon: IconSparkles, eyebrow: "WEEKLY", title: "洞察", desc: "把一周的信息压成值得长期保存的判断。", action: "打开洞察" },
  { view: "shelf", icon: IconBooks, eyebrow: "LIBRARY", title: "书架", desc: "从长期阅读里寻找观点、案例和结构，而不是追着热度跑。", action: "继续阅读" },
];

export function Discover({ onGo }) {
  return (
    <>
      <PageHeader title="发现" desc="外面的信息只在这里停留。真正要写的东西，进入内容；能复用的东西，进入素材。" />
      <div className="discover-grid">
        {ENTRIES.map(({ view, icon: Icon, eyebrow, title, desc, action }, index) => (
          <button key={view} className="discover-card" onClick={() => onGo(view)}>
            <span className="discover-card__number">0{index + 1}</span>
            <span className="discover-card__icon"><Icon aria-hidden="true" stroke={1.6} /></span>
            <span className="eyebrow">{eyebrow}</span>
            <strong>{title}</strong>
            <span className="discover-card__desc">{desc}</span>
            <span className="discover-card__action">{action}<IconArrowRight aria-hidden="true" /></span>
          </button>
        ))}
      </div>
    </>
  );
}
