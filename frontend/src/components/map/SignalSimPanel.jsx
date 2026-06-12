import { useState, useEffect } from "react";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

function TrafficLight({ active }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%",
        background: active ? "#22c55e" : "#1e293b",
        boxShadow: active ? "0 0 10px #22c55e88" : "none",
        border: "2px solid rgba(255,255,255,0.1)",
        transition: "all 0.3s"
      }} />
      <div style={{
        width: 22, height: 22, borderRadius: "50%",
        background: !active ? "#ef4444" : "#1e293b",
        boxShadow: !active ? "0 0 10px #ef444488" : "none",
        border: "2px solid rgba(255,255,255,0.1)",
        transition: "all 0.3s"
      }} />
    </div>
  );
}

export default function SignalSimPanel({ intNo, intNm, onPhaseChange, phaseOverride, onContextChange }) {
  const [ctx,         setCtx]         = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [now,         setNow]         = useState(new Date());
  const [livePhaseNo, setLivePhaseNo] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!intNo) return;
    let alive = true;

    const loadContext = (showLoading = false) => {
      if (showLoading) setLoading(true);
      fetch(`${API_BASE}/api/signal/simulation/context/${intNo}`)
        .then(r => r.json())
        .then(d => {
          if (!alive) return;
          setCtx(d);
          onContextChange?.(d);
          setLoading(false);
        })
        .catch(() => {
          if (!alive) return;
          onContextChange?.(null);
          setLoading(false);
        });
    };

    loadContext(true);
    const id = setInterval(() => loadContext(false), 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intNo, onContextChange]);

  // 1초마다 현재 현시 재계산
  useEffect(() => {
    const phases = phaseOverride?.length ? phaseOverride : ctx?.phases;
    if (!phases?.length) return;
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const cycleVal = phaseOverride?.length
      ? phaseOverride.reduce((sum, p) => sum + Number(p.sec || 0), 0)
      : ctx.cycleVal || 120;
    const planStartSec = ctx.planStartSec ?? 0;
    const elapsed = ((nowSec - planStartSec) % cycleVal + cycleVal) % cycleVal;
    let acc = 0;
    let phaseNo = phases[0].no;
    for (const p of phases) {
      acc += p.sec;
      if (elapsed < acc) { phaseNo = p.no; break; }
    }
    setLivePhaseNo(phaseNo);
    onPhaseChange?.(phaseNo);
  }, [ctx, now, phaseOverride, onPhaseChange]);

  const getActivePhaseDirs = () => {
    const phases = phaseOverride?.length ? phaseOverride : ctx?.phases;
    const activePhase = phases?.find(p => p.no === livePhaseNo);
    return new Set((activePhase?.dirs || []).filter(d => d !== "전적색"));
  };

  const isPhaseActive = (phase) => {
    const activeDirs = getActivePhaseDirs();
    if (activeDirs.size === 0) return phase.no === livePhaseNo;
    return phase.dirs?.some(d => d !== "전적색" && activeDirs.has(d));
  };

  if (loading) return (
    <div style={{ padding: 20, color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
      신호 데이터 로딩 중...
    </div>
  );

  if (!ctx || ctx.error) return (
    <div style={{ padding: 20, color: "#64748b", fontSize: 13, textAlign: "center" }}>
      {ctx?.error || "신호 데이터 없음"}
    </div>
  );

  if (!ctx.phases?.length || ctx.warning) return (
    <div style={{ padding: 20, color: "#64748b", fontSize: 13, textAlign: "center" }}>
      {ctx.warning || "신호계획 데이터 없음"}
    </div>
  );

  const displayPhases = phaseOverride?.length ? phaseOverride : ctx.phases;
  const cycleVal     = phaseOverride?.length
    ? phaseOverride.reduce((sum, p) => sum + Number(p.sec || 0), 0)
    : ctx.cycleVal || 120;
  const planStartSec = ctx.planStartSec ?? 0;
  const nowSec       = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const elapsed      = ((nowSec - planStartSec) % cycleVal + cycleVal) % cycleVal;
  const remaining    = cycleVal - elapsed;

  return (
    <div style={{ fontSize: 13, color: "#e2e8f0", height: "100%", overflowY: "auto" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#60a5fa" }}> {intNm}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>{now.toLocaleTimeString("ko-KR")}</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 4 }}>
          <span>사이클 진행</span>
          <span>{elapsed}s / {cycleVal}s (잔여 {remaining}s)</span>
        </div>
        <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2,
            width: `${(elapsed / cycleVal) * 100}%`,
            background: "linear-gradient(90deg, #3b82f6, #22c55e)",
            transition: "width 0.9s linear"
          }} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {displayPhases.map(p => {
          const isActive = isPhaseActive(p);
          return (
            <div key={p.no} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 5,
              background: isActive ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${isActive ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.06)"}`,
              transition: "all 0.3s"
            }}>
              <TrafficLight active={isActive} />
              <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? "#22c55e" : "#64748b", minWidth: 42 }}>
                현시 {p.no}
              </span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                {p.dirs?.map((d, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: "1px 6px", borderRadius: 3,
                    background: isActive ? "rgba(34,197,94,0.15)" : "rgba(78,166,255,0.08)",
                    border: `1px solid ${isActive ? "rgba(34,197,94,0.3)" : "rgba(78,166,255,0.15)"}`,
                    color: isActive ? "#22c55e" : "#4ea6ff"
                  }}>{d}</span>
                ))}
              </div>
              <span style={{ fontSize: 11, color: "#475569", fontFamily: "monospace" }}>{p.sec}s</span>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: "#475569", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
        INT_NO: {intNo} · 현시수: {displayPhases.length}
        {ctx.traffic?.speedKph != null && (
          <span style={{ marginLeft: 8, color: ctx.traffic.realTime ? "#22c55e" : "#f59e0b" }}>
            · 실시간 {(() => { const v = Math.round(ctx.traffic.speedKph * 10) / 10; return v % 1 === 0 ? v : v.toFixed(1); })()}km/h
          </span>
        )}
      </div>
    </div>
  );
}
