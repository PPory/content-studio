import { useEffect, useState } from "react";
import { AssistantPane } from "../components/ProjectAssistantRail.jsx";
import { IconSparkles } from "../components/icons.jsx";
import { api } from "../lib/api.js";

export function Assistant() {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    api.writingProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  return <section className="assistant-page">
    <header className="assistant-page__head">
      <div><span><IconSparkles aria-hidden="true" />独立工作区</span><h1>AI 助手</h1></div>
      <p>直接对话，或让它搜索知识库、联网查证、调用专家。这里不绑定某一篇文章。</p>
    </header>
    <div className="assistant-page__conversation">
      <AssistantPane
        scopeId="global:assistant"
        document={{ title: "AI 助手独立对话", body: "", platform: "", audience: profile?.profile?.audience || "" }}
        profile={profile}
        standalone
      />
    </div>
  </section>;
}
