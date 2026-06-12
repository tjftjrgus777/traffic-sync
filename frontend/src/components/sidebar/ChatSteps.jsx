/**
 * 챗봇 추론 단계 표시 컴포넌트 모음
 * ------------------------------------------------------------------
 * AI 에이전트의 ReAct 추론(생각/도구 사용/결과 확인)을 시각화한다.
 * - ThinkingDots  : 점 3개 깜빡이는 로딩 인디케이터
 * - StepRows      : 단계 목록 (라벨 + 내용)
 * - InlineSteps   : 완료된 메시지의 "추론 과정 N단계" 접이식 블록
 * - ThinkingBlock : 스트리밍 중 "추론 중..." 진행 블록
 */

// SSE step.type → 한글 라벨
const STEP_LABEL = {
  thought: "생각",
  action: "도구 사용",
  observation: "결과 확인",
};

export function ThinkingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 3, height: 3, borderRadius: "50%",
          background: "rgba(255,255,255,0.45)", display: "inline-block",
          animation: `chatDotBlink 1.2s ease ${i * 0.2}s infinite`,
        }} />
      ))}
    </span>
  );
}

export function StepRows({ steps }) {
  return (
    <div style={{ padding: "6px 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {steps.map((step, i) => {
        const label = STEP_LABEL[step.type] ?? step.type;
        const text = step.type === "action"
          ? (step.tool ? `${step.tool}${step.args ? `(${step.args})` : ""}` : step.content ?? "")
          : (step.content ?? "");
        return (
          <div key={i} style={{ display: "flex", gap: 10, animation: "chatFadeIn .15s ease" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", minWidth: 54, flexShrink: 0, paddingTop: 1, fontFamily: "system-ui,sans-serif" }}>
              {label}
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.48)", lineHeight: 1.55, wordBreak: "break-all", fontFamily: "system-ui,sans-serif" }}>
              {text.length > 140 ? text.slice(0, 140) + "…" : text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InlineSteps({ steps, collapsed, onToggle, label }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden", marginBottom: 4 }}>
      <button onClick={onToggle} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
        background: "rgba(255,255,255,0.025)", border: "none", cursor: "pointer",
        color: "rgba(255,255,255,0.38)", fontSize: 11, textAlign: "left", fontFamily: "system-ui,sans-serif",
      }}>
        <span style={{ fontSize: 8, transition: "transform .2s", transform: collapsed ? "rotate(-90deg)" : "none", display: "inline-block" }}>▾</span>
        {label ?? `추론 과정 · ${steps.length}단계`}
      </button>
      {!collapsed && <StepRows steps={steps} />}
    </div>
  );
}

export function ThinkingBlock({ steps }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
        background: "rgba(255,255,255,0.025)", color: "rgba(255,255,255,0.38)", fontSize: 11,
        fontFamily: "system-ui,sans-serif",
      }}>
        <ThinkingDots />
        <span style={{ marginLeft: 2 }}>추론 중{steps.length > 0 ? ` · ${steps.length}단계` : ""}</span>
      </div>
      {steps.length > 0 && <StepRows steps={steps} />}
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)" }}>
        <div style={{ height: "100%", background: "rgba(255,255,255,0.14)", animation: "chatProgressBar 2.4s ease infinite" }} />
      </div>
    </div>
  );
}
