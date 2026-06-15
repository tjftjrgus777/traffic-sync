// 시뮬레이션 페이지 공통 UI 컴포넌트 모음
import { useState, useEffect, useRef } from "react";

// 공통 카드 스타일
export const cardStyle = {
  background: "var(--syncro-bg1)",
  border: "1px solid var(--syncro-line)",
  borderRadius: 6,
  padding: 16,
  boxShadow: "var(--syncro-inner-shadow)",
};

export const smallLabel = {
  fontSize: 11,
  color: "var(--syncro-ink2)",
  marginBottom: 5,
};

// 탭 버튼 스타일 (활성/비활성)
export function tabButtonStyle(active, enabled) {
  return {
    padding: "8px 10px", borderRadius: 5,
    border: `1px solid ${active ? "rgba(96,165,250,0.65)" : "var(--syncro-line)"}`,
    background: active ? "rgba(96,165,250,0.18)" : "var(--syncro-bg2)",
    color: !enabled ? "var(--syncro-ink3)" : active ? "#1d4ed8" : "var(--syncro-ink2)",
    cursor: enabled ? "pointer" : "default",
    fontSize: 12, fontWeight: 800, fontFamily: "inherit",
  };
}

export function slideButtonStyle(enabled) {
  return {
    width: 34, height: 34, borderRadius: "50%",
    border: `1px solid ${enabled ? "rgba(245,158,11,0.55)" : "var(--syncro-line)"}`,
    background: enabled ? "rgba(245,158,11,0.12)" : "var(--syncro-bg2)",
    color: enabled ? "#fbbf24" : "var(--syncro-ink3)",
    cursor: enabled ? "pointer" : "default",
    fontSize: 24, fontWeight: 900, lineHeight: "28px", fontFamily: "inherit",
  };
}

// 경로 포인트 카드 (출발지/경유지/목적지)
export function RoutePointCard({ type, title, crossroad, empty }) {
  const isStart = type === "start";
  const isWaypoint = type === "waypoint";
  const color = isStart ? "#22c55e" : isWaypoint ? "#f59e0b" : "#ef4444";
  const emoji = isStart ? "🟢" : isWaypoint ? "🟠" : "🔴";
  return (
    <div style={{ padding: 10, borderRadius: 5, background: "var(--syncro-bg2)", border: `1px solid ${crossroad ? color + "66" : "var(--syncro-line)"}` }}>
      <div style={smallLabel}>{emoji} {title}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: crossroad ? color : "var(--syncro-ink2)" }}>{crossroad?.intNm || empty}</div>
      {crossroad && <div style={{ marginTop: 4, fontSize: 11, color: "var(--syncro-ink3)", fontFamily: "monospace" }}>INT_NO: {crossroad.intNo}</div>}
    </div>
  );
}

// 숫자 카운트업 애니메이션 훅
export function useCountUp(target, duration = 700) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    if (target == null) return;
    const from = prevRef.current ?? 0;
    const to = target;
    prevRef.current = to;
    if (from === to) return;

    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

// 메트릭 표시 박스 (거리, 시간 등)
export function MetricBox({ label, value, color = "var(--syncro-ink0)", sub, animate = false }) {
  const numMatch = typeof value === "string" ? value.match(/^[\d.]+/) : null;
  const numPart = numMatch ? parseFloat(numMatch[0]) : null;
  const suffix = numMatch ? value.slice(numMatch[0].length) : "";
  const counted = useCountUp(animate && numPart != null ? numPart : null);
  const displayValue = animate && numPart != null ? `${counted}${suffix}` : value;

  return (
    <div style={{ padding: 10, borderRadius: 5, background: "var(--syncro-bg2)", border: "1px solid var(--syncro-line)" }}>
      <div style={smallLabel}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color, transition: "color 0.4s" }}>{displayValue}</div>
      {sub && <div style={{ marginTop: 2, fontSize: 11, color: "var(--syncro-ink2)" }}>{sub}</div>}
    </div>
  );
}

// 경유지/병목지 슬라이드 탐색 컨트롤
export function WaypointSlideControl({ waypoints, currentIndex, onChange, label = "경유지" }) {
  const current = waypoints[currentIndex] ?? null;
  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button onClick={() => onChange(i => Math.max(0, i - 1))} disabled={currentIndex <= 0} style={slideButtonStyle(currentIndex > 0)} title="이전">‹</button>

        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ color: "#f59e0b", fontSize: 13, fontWeight: 900 }}>{label} {currentIndex + 1} / {waypoints.length}</div>
          <div style={{ marginTop: 4, color: "var(--syncro-ink0)", fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.intNm || "선택 필요"}
          </div>
          {current?.intNo && <div style={{ marginTop: 3, color: "var(--syncro-ink3)", fontSize: 10, fontFamily: "monospace" }}>INT_NO: {current.intNo}</div>}
        </div>

        <button onClick={() => onChange(i => Math.min(waypoints.length - 1, i + 1))} disabled={currentIndex >= waypoints.length - 1} style={slideButtonStyle(currentIndex < waypoints.length - 1)} title="다음">›</button>
      </div>

      {/* 페이지 인디케이터 */}
      <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 10 }}>
        {waypoints.map((_, idx) => (
          <button key={idx} onClick={() => onChange(idx)} style={{ width: idx === currentIndex ? 18 : 7, height: 7, borderRadius: 999, border: "none", background: idx === currentIndex ? "#f59e0b" : "rgba(148,163,184,0.35)", cursor: "pointer", padding: 0, transition: "all 0.2s" }} />
        ))}
      </div>
    </div>
  );
}

// AI 분석 로딩 애니메이션 (점 3개 깜빡임)
export function AnalysisLoadingBlock() {
  return (
    <span style={{ color: "var(--syncro-ink2)", display: "flex", alignItems: "center", gap: 6 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa", display: "inline-block", animation: `chatDotBlink 1.2s ease ${i * 0.2}s infinite` }} />
      ))}
      <span style={{ fontSize: 12 }}>AI 분석 중...</span>
    </span>
  );
}
