import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

export default function SimSliderPanel({
  intNo, intNm, onSave, onAutoApplied, aiSuggestedValues, aiAdjustKey,
  initialPhases, initialCycleVal,
}) {
  const [phases, setPhases] = useState([]);
  const [cycleVal, setCycleVal] = useState(null);
  const [sliders, setSliders] = useState({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoAnimating, setAutoAnimating] = useState(false);
  // phases 로드 완료 후 적용할 AI 제안값을 보관
  const pendingAiRef = useRef(null);
  const animatingRef = useRef(false);

  // easeOutCubic 슬라이더 애니메이션
  const runAnimation = useCallback((targetValues, currentPhases, fromValues, onDone) => {
    if (!currentPhases.length || !targetValues) return;
    const from = Object.fromEntries(currentPhases.map(p => [p.no, Number(fromValues?.[p.no] ?? p.sec ?? 0)]));
    const steps = 24;
    let step = 0;
    animatingRef.current = true;
    setAutoAnimating(true);
    setSaved(false);
    const timer = setInterval(() => {
      step++;
      const eased = 1 - Math.pow(1 - step / steps, 3);
      const next = {};
      currentPhases.forEach(p => {
        const start = Number(from[p.no] ?? p.sec ?? 0);
        const end = Number(targetValues[p.no] ?? p.sec ?? start);
        next[p.no] = Math.round(start + (end - start) * eased);
      });
      setSliders(next);
      if (step >= steps) {
        clearInterval(timer);
        setSliders(targetValues);
        animatingRef.current = false;
        setAutoAnimating(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
        const simulation = currentPhases.map(p => ({ no: p.no, sec: targetValues[p.no] ?? p.sec, dirs: p.dirs }));
        onDone?.(simulation);
      }
    }, 45);
  }, []);

  // intNo 변경 시 phases 로드
  // VehicleSignalPanel이 이미 가져온 initialPhases가 있으면 그걸 쓰고, 없으면 DB fetch
  useEffect(() => {
    if (!intNo) return;
    setSliders({});
    setSaved(false);

    if (initialPhases?.length > 0) {
      setPhases(initialPhases);
      setCycleVal(initialCycleVal ?? null);
      if (pendingAiRef.current && !animatingRef.current) {
        const target = pendingAiRef.current;
        pendingAiRef.current = null;
        const fromVals = Object.fromEntries(initialPhases.map(p => [p.no, p.sec]));
        runAnimation(target, initialPhases, fromVals, (simulation) => {
          onAutoApplied?.(simulation);
        });
      }
      return;
    }

    setLoading(true);
    fetch(`${API_BASE}/api/signal/simulation/context/${intNo}`)
      .then(r => r.json())
      .then(d => {
        const loaded = d.phases || [];
        setPhases(loaded);
        setCycleVal(d.cycleVal ?? null);
        if (pendingAiRef.current && loaded.length && !animatingRef.current) {
          const target = pendingAiRef.current;
          pendingAiRef.current = null;
          const fromVals = Object.fromEntries(loaded.map(p => [p.no, p.sec]));
          runAnimation(target, loaded, fromVals, (simulation) => {
            onAutoApplied?.(simulation);
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [intNo, runAnimation]);

  // initialPhases 변경 시 — 기준값 갱신 + remount 후 pending AI 있으면 소비
  useEffect(() => {
    if (!initialPhases?.length) return;
    if (Object.keys(sliders).length === 0) {
      setPhases(initialPhases);
      setCycleVal(initialCycleVal ?? null);
      if (pendingAiRef.current && !animatingRef.current) {
        const target = pendingAiRef.current;
        pendingAiRef.current = null;
        const fromVals = Object.fromEntries(initialPhases.map(p => [p.no, p.sec]));
        runAnimation(target, initialPhases, fromVals, (simulation) => {
          onAutoApplied?.(simulation);
        });
      }
    }
  }, [initialPhases]);

  // AI 제안값 도착 시 — phases가 있으면 즉시 실행, 없으면 pending으로 저장
  useEffect(() => {
    if (!aiSuggestedValues) return;
    if (animatingRef.current) return;
    if (phases.length) {
      const fromVals = Object.fromEntries(phases.map(p => [p.no, sliders[p.no] ?? p.sec]));
      runAnimation(aiSuggestedValues, phases, fromVals, (simulation) => {
        onAutoApplied?.(simulation);
      });
    } else {
      pendingAiRef.current = aiSuggestedValues;
    }
  }, [aiAdjustKey]);

  if (!intNo) return null;
  if (loading) return <div style={{ padding: "12px 0", fontSize: 12, color: "#64748b", textAlign: "center" }}>슬라이더 데이터 로딩 중...</div>;
  if (!phases.length) return null;

  const totalSec = phases.reduce((s, p) => s + (sliders[p.no] ?? p.sec), 0);
  const cycleTarget = cycleVal ?? phases.reduce((s, p) => s + p.sec, 0);
  const overTarget = totalSec > cycleTarget;

  const handleSave = () => {
    if (autoAnimating) return;
    const simulation = phases.map(p => ({ no: p.no, sec: sliders[p.no] ?? p.sec, dirs: p.dirs }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    onSave?.(simulation);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: autoAnimating ? "#22c55e" : "#94a3b8" }}>신호 시뮬레이션 조정</div>
        {autoAnimating && <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 800 }}>자동 조정 중...</div>}
      </div>
      {phases.map(p => {
        const sec = sliders[p.no] ?? p.sec;
        const changed = sliders[p.no] != null && sliders[p.no] !== p.sec;
        return (
          <div key={p.no} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${changed ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: 5, padding: "8px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>현시 {p.no}</span>
                {p.dirs?.map((d, i) => (
                  <span key={i} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(78,166,255,0.1)", border: "1px solid rgba(78,166,255,0.2)", color: "#4ea6ff" }}>{d}</span>
                ))}
              </div>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: changed ? "#f59e0b" : "#64748b" }}>
                {sec}s{changed ? ` (원래 ${p.sec}s)` : ""}
              </span>
            </div>
            <input
              type="range" min={5} max={120} step={1} value={sec}
              onChange={e => setSliders(prev => ({ ...prev, [p.no]: Number(e.target.value) }))}
              style={{ width: "100%", accentColor: autoAnimating ? "#22c55e" : changed ? "#f59e0b" : "#3b82f6", cursor: "pointer", transition: "all 0.2s" }}
            />
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          합계: <span style={{ color: overTarget ? "#ef4444" : totalSec < cycleTarget ? "#f59e0b" : "#22c55e", fontWeight: 600 }}>{totalSec}s</span>
          <span style={{ color: "#475569" }}> / 목표 {cycleTarget}s</span>
        </span>
        <button
          onClick={handleSave}
          disabled={autoAnimating}
          style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 4, border: "none", cursor: autoAnimating ? "not-allowed" : "pointer", fontFamily: "inherit", background: autoAnimating ? "#16a34a" : saved ? "#22c55e" : "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 700, transition: "background 0.3s" }}
        >
          {autoAnimating ? "조정 중..." : saved ? "✓ 발송됨" : "email 발송"}
        </button>
      </div>
    </div>
  );
}
