// 筛选条：状态芯片 + 分面下拉。
// 从 `pages/Studio.jsx` 的 return 里原样外提，JSX 一字未动（只去掉了整体缩进）。
//
// **「要不要显示」留在页面那边**，这里只管「显示成什么样」——那个条件同时看
// `source.states`、`layout` 和 `facetPick` 三样，是页面的编排问题不是这一条的事。
import { Select, fieldIcon, stateIcon, valueIcon } from "../../components/ui.jsx";
import { IconShieldCheck } from "../../components/icons.jsx";

export function FilterBar({ source, showStates, state, onState, facet, setFacet, facetPick, verification, setVerification, counts = {} }) {
  const verificationOptions = source.verificationFilters || [];
  const verificationAll = "全部核验状态";
  return (
    <div className="filter-bar">
      {/**
        * ⚠️ **要不要画状态芯片由调用方给（`showStates`），这儿不再自己判一遍。**
        * 素材页的那排芯片已经撤了——那一页的链路块（`MaterialFlow`）本身就是状态筛选器，
        * 两者同时在屏幕上时是**同一组数字一屏两份**，而点哪一份效果完全一样。
        * 判据只写一处：写两处的话，加一个源就会出现「壳画了、里面空着」那种半死状态。
        */}
      {showStates ? (
        <div className="chips chips-sm" aria-label="按处理状态筛选">
          <button className="chip" aria-pressed={!state} onClick={() => onState("")}>全部{counts.total != null ? ` ${counts.total}` : ""}</button>
          {source.stateTabs.map((s) => (
            <button key={s} className="chip" aria-pressed={state === s} onClick={() => onState(s)}>
              {s}{counts[s] != null ? ` ${counts[s]}` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {facetPick ? (
        <Select
          value={facetPick.rows.find((r) => r.value === facet)?.label ?? facetPick.all}
          options={facetPick.options}
          onChange={(label) => setFacet(facetPick.rows.find((r) => r.label === label)?.value ?? "")}
          /**
           * 每一项**用自己的图标**。整列同一枚的话七行长得一模一样，
           * 图标就不提供任何信息、只在每行左边占 15px（做过一版，就是这样）。
           * 「全部平台」那一行例外：它代表整个维度而不是某个值，所以用**字段**图标
           * （和元信息行里「适配平台」是同一个记号）。
           * 认不出的值回落到字段图标——宁可给个通用的，也不要一列里有的有有的没有。
           */
          renderIcon={(label) => {
            const F = fieldIcon(source.facet.label);
            const v = facetPick.rows.find((r) => r.label === label)?.value;
            const I = v ? valueIcon(v, F) : F;
            return <I size={15} stroke={1.8} aria-hidden="true" />;
          }}
          ariaLabel={`按${source.facet.label}筛选`}
          title={`只看某一个${source.facet.label}的条目`}
        />
      ) : null}
      {verificationOptions.length ? (
        <Select
          value={verification || verificationAll}
          options={[verificationAll, ...verificationOptions]}
          onChange={(value) => setVerification(value === verificationAll ? "" : value)}
          /**
           * ⚠️ **`renderIcon` 不传的话这个下拉里一枚图标都没有**（`Select` 里
           * `renderIcon ? renderIcon(o) : null`），三项只剩三行字。而这三项恰恰是
           * 靠形状分辨最省事的：盾牌=核过了、减号=压根不需要核、虚线圈=等你去核。
           * 「全部核验状态」代表整个维度而不是某个值，所以给它盾牌那枚字段记号。
           */
          renderIcon={(label) => {
            const I = label === verificationAll ? IconShieldCheck : stateIcon(label);
            return <I size={15} stroke={1.8} aria-hidden="true" />;
          }}
          ariaLabel="按核验状态筛选"
          title="只看某一种证据核验状态"
        />
      ) : null}
    </div>
  );
}
