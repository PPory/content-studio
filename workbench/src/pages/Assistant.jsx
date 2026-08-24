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
    <div className="assistant-page__canvas">
      <header className="assistant-page__head">
        <div className="assistant-page__brand">
          <span className="assistant-page__mark"><IconSparkles aria-hidden="true" /></span>
          <div><span>Xenho AI</span><h1>AI 助手</h1></div>
        </div>
        <p>一个不绑定某篇文章的思考空间。直接问，或调用知识库、公开网页和专家。</p>
      </header>
      <div className="assistant-page__conversation">
        <AssistantPane
          scopeId="global:assistant"
          document={{ title: "AI 助手独立对话", body: "", platform: "", audience: profile?.profile?.audience || "" }}
          profile={profile}
          standalone
        />
      </div>
    </div>
  </section>;
}
