// 目录还不存在时的引导。从 `pages/Studio.jsx` 搬出来，函数体一字未动。
//
// **每个源说自己的话。** 踩过一次：洞察页显示着书架的「一本书一个子目录」——
// 空态是用户第一次见到这个功能的地方，说错了他会照着去建错的目录。

import { Note } from "../../components/ui.jsx";
import { IconSparkles } from "../../components/icons.jsx";

// 目录还不存在时的引导。每个源说自己的话。
export function SourceSetup({ source, dir }) {
  if (source.key === "insights") {
    return (
      <Note title="还没有洞察报告">
        <p style={{ margin: "6px 0" }}>
          <IconSparkles aria-hidden="true" size={15} stroke={1.7} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          报告是按需生成的，不是实时数据。在工作台 Agent 里说 <b>「跑一次社媒洞察」</b>，产出的 Markdown 会落进 vault 的{" "}
          {/* 路径由服务端给，不在这儿抄一份——抄的那份在目录改名之后会**指着一个不存在的地方**，
              而这段话的全部作用就是告诉人东西落在哪。 */}
          <code>{dir || "洞察"}/</code>，回这里就能读、能划词批注、能摘成素材。
        </p>
        <p style={{ margin: "6px 0", color: "var(--text-3)" }}>每周跑一次足够。</p>
      </Note>
    );
  }
  return <Note title={source.emptyHint} />;
}
