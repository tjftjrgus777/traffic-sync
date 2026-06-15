// 차량 추종 현시 표시가 포함된 신호체계 패널
import { useState, useEffect } from "react";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

// 현재 시각 기준 활성 현시 및 잔여 시간 계산
export function getCurrentSignalPhaseInfo(context, now = new Date()) {
  const phases = context?.phases || [];
  if (!phases.length) return { currentPhaseNo: null, elapsed: 0, cycleVal: 0, remainSec: 0 };

  const cycleVal = Number(context?.cycleVal)
    || phases.reduce((sum, p) => sum + Number(p.sec || 0), 0)
    || 120;
  const planStartSec = Number(context?.planStartSec ?? 0);
  const nowSec = Math.floor(now.getTime() / 1000) % 86400;
  const elapsed = ((nowSec - planStartSec) % cycleVal + cycleVal) % cycleVal;

  let acc = 0, currentPhaseNo = phases[0]?.no ?? null, remainSec = 0;
  for (const phase of phases) {
    acc += Number(phase.sec || 0);
    if (elapsed < acc) {
      currentPhaseNo = phase.no;
      remainSec = Math.max(0, Math.ceil(acc - elapsed));
      break;
    }
  }
  return { currentPhaseNo, elapsed, cycleVal, remainSec };
}

function normalizePhaseNo(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

export default function VehicleSignalPanel({
  intNo, intNm, onPhaseChange, phaseOverride, onContextChange, currentVehicleSignal,
}) {
  const [context, setContext] = useState(null);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!intNo) return;
    let alive = true;
    setLoading(true);
    fetch(`${API_BASE}/api/signal/simulation/context/${intNo}`)
      .then(r => r.json())
      .then(data => {
        if (!alive) return;
        const next = { ...data, phases: phaseOverride || data.phases || [] };
        setContext(next);
        onContextChange?.(next);
      })
      .catch(() => alive && setContext({ phases: [] }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [intNo]);

  // phaseOverride 변경 시 context 갱신 (슬라이더 저장 후 반영)
  useEffect(() => {
    if (!context || !phaseOverride) return;
    const next = { ...context, phases: phaseOverride };
    setContext(next);
    onContextChange?.(next);
  }, [phaseOverride]);

  // 1초마다 현재 시각 갱신 → 현시 카운트다운
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const phases = context?.phases || [];
  const { currentPhaseNo, elapsed, cycleVal, remainSec } = getCurrentSignalPhaseInfo(context, now);

  useEffect(() => {
    if (currentPhaseNo != null) onPhaseChange?.(currentPhaseNo);
  }, [currentPhaseNo, onPhaseChange]);

  if (loading) return <div style={{ padding: "12px 0", fontSize: 12, color: "var(--syncro-ink2)", textAlign: "center" }}>신호 데이터 로딩 중...</div>;
  if (!phases.length) return <div style={{ padding: "22px 10px", color: "var(--syncro-ink2)", fontSize: 13, lineHeight: 1.7, textAlign: "center" }}>신호계획 데이터가 비어 있습니다.</div>;

  const activeVehicleSignal = currentVehicleSignal?.intNo != null && String(currentVehicleSignal.intNo) === String(intNo);
  const vehiclePhaseNo = activeVehicleSignal ? normalizePhaseNo(currentVehicleSignal?.phaseNo ?? currentVehicleSignal?.phase) : null;
  const isVehicleRed = !!currentVehicleSignal?.isRed;
  const isVehicleGreen = !!currentVehicleSignal?.isGreen;
  const progressPercent = cycleVal ? Math.min(100, Math.max(0, (elapsed / cycleVal) * 100)) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ color: "#60a5fa", fontWeight: 900, fontSize: 15 }}>{intNm}</div>
        <div style={{ color: "var(--syncro-ink2)", fontSize: 11 }}>{now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--syncro-ink2)", fontSize: 11, marginBottom: 4 }}>
        <span>사이클 진행</span>
        <span>{Math.floor(elapsed)}s / {cycleVal}s {remainSec ? `(잔여 ${remainSec}s)` : ""}</span>
      </div>

      {/* 사이클 진행 바 */}
      <div style={{ height: 4, background: "var(--syncro-grid-line)", borderRadius: 999, overflow: "hidden", marginBottom: 9 }}>
        <div style={{ width: `${progressPercent}%`, height: "100%", background: "linear-gradient(90deg,#38bdf8,#22c55e)", borderRadius: 999 }} />
      </div>

      {/* 차량 추종 현시 표시 */}
      {activeVehicleSignal && vehiclePhaseNo != null && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8,
          padding: "7px 9px", borderRadius: 6,
          background: isVehicleRed ? "rgba(127,29,29,0.18)" : "rgba(22,101,52,0.16)",
          border: `1px solid ${isVehicleRed ? "rgba(239,68,68,0.34)" : "rgba(34,197,94,0.30)"}`,
          color: "var(--syncro-ink1)", fontSize: 11,
        }}>
          <span>🚗 차량 추종 예정: <b style={{ color: "var(--syncro-ink0)" }}>현시 {vehiclePhaseNo}</b></span>
          <span style={{ color: isVehicleRed ? "#b91c1c" : "#166534", fontWeight: 800 }}>
            {isVehicleRed ? "정지/대기" : "통과 가능"}
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {phases.map(phase => {
          const phaseNo = normalizePhaseNo(phase.no);
          const isCurrent = String(phaseNo) === String(currentPhaseNo);
          const isVehicleFollowing = activeVehicleSignal && String(phaseNo) === String(vehiclePhaseNo);
          const isVehicleStopPhase = isVehicleFollowing && isVehicleRed;

          const borderColor = isVehicleFollowing
            ? isVehicleStopPhase ? "rgba(239,68,68,0.78)" : "rgba(34,197,94,0.78)"
            : isCurrent ? "rgba(34,197,94,0.45)" : "var(--syncro-line)";
          const bgColor = isVehicleFollowing
            ? isVehicleStopPhase ? "rgba(127,29,29,0.26)" : "rgba(22,101,52,0.25)"
            : isCurrent ? "rgba(22,101,52,0.18)" : "var(--syncro-bg2)";

          return (
            <div key={phase.no} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
              borderRadius: 6, background: bgColor, border: `1px solid ${borderColor}`,
              boxShadow: isVehicleFollowing ? `0 0 14px ${isVehicleStopPhase ? "rgba(239,68,68,0.22)" : "rgba(34,197,94,0.20)"}` : "none",
            }}>
              {isVehicleFollowing && <span title="현재 차량이 추종 중인 현시" style={{ fontSize: 17, lineHeight: 1 }}>🚗</span>}

              {/* 초록/빨간 신호등 인디케이터 */}
              <span style={{ width: 18, height: 18, borderRadius: "50%", background: isCurrent ? "#22c55e" : "var(--syncro-grid-line)", border: `1px solid ${isCurrent ? "rgba(34,197,94,0.65)" : "rgba(148,163,184,0.28)"}`, boxShadow: isCurrent ? "0 0 10px rgba(34,197,94,0.55)" : "none", flexShrink: 0 }} />
              <span style={{ width: 18, height: 18, borderRadius: "50%", background: isCurrent ? "var(--syncro-grid-line)" : "#ef4444", border: `1px solid ${isCurrent ? "rgba(148,163,184,0.28)" : "rgba(239,68,68,0.55)"}`, boxShadow: !isCurrent ? "0 0 10px rgba(239,68,68,0.45)" : "none", flexShrink: 0 }} />

              <span style={{ color: isVehicleFollowing ? "var(--syncro-ink0)" : isCurrent ? "#16a34a" : "var(--syncro-ink2)", fontSize: 12, fontWeight: isVehicleFollowing || isCurrent ? 900 : 700, minWidth: 42 }}>
                현시 {phase.no}
              </span>

              {(isCurrent || isVehicleFollowing) && (
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {isCurrent && <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 999, background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.32)", color: "#166534", fontWeight: 800 }}>현재</span>}
                  {isVehicleFollowing && (
                    <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 999, background: isVehicleStopPhase ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.16)", border: `1px solid ${isVehicleStopPhase ? "rgba(239,68,68,0.32)" : "rgba(59,130,246,0.32)"}`, color: isVehicleStopPhase ? "#b91c1c" : "#1d4ed8", fontWeight: 800 }}>추종</span>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 0, flex: 1 }}>
                {(phase.dirs || []).map((dir, idx) => (
                  <span key={`${phase.no}-${idx}`} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: isVehicleFollowing ? "rgba(34,197,94,0.14)" : "rgba(78,166,255,0.1)", border: `1px solid ${isVehicleFollowing ? "rgba(34,197,94,0.25)" : "rgba(78,166,255,0.2)"}`, color: isVehicleFollowing ? "#166534" : "#2563eb", whiteSpace: "nowrap" }}>
                    {dir}
                  </span>
                ))}
              </div>

              <span style={{ marginLeft: "auto", color: "var(--syncro-ink2)", fontSize: 11, fontFamily: "monospace" }}>{phase.sec}s</span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, color: "var(--syncro-ink3)", fontSize: 10, fontFamily: "monospace" }}>
        INT_NO: {intNo} · 현시수: {phases.length}
      </div>
    </div>
  );
}
