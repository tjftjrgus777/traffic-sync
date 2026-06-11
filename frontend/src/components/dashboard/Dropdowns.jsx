/**
 * 대시보드 드롭다운 모음
 * ------------------------------------------------------------------
 * - StationPredictDropdown : 예측 차트용 교통량 지점 선택 (단순 select)
 * - SpeedDropdown          : 속도 모니터링 교차로 선택 (검색 + 최대 3개 토글)
 * - RiskDropdown           : 관심 교차로 검색/등록 (등록 모드/선택 모드)
 */
import { useState, useEffect, useRef } from "react";
import { V } from "../../constants/theme";
import { hasRiskScore, riskColor, riskLevel } from "../../utils/riskUtils";

/** 외부 클릭 시 드롭다운을 닫는 공통 effect 훅 */
function useCloseOnOutside(ref, onClose) {
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onClose]);
}

// ── 예측 지점 선택 (단순 네이티브 select) ──────────────────────────
export function StationPredictDropdown({ stations, selectedId, onSelect }) {
  return (
    <select value={selectedId} onChange={(e) => onSelect(e.target.value)}
      style={{ background: "var(--field-bg)", border: `1px solid ${V.line}`, borderRadius: 4, color: V.ink0, fontSize: 13, padding: "6px 12px", fontFamily: V.sans, outline: "none", cursor: "pointer", minWidth: "220px" }}>
      {stations.map((st) => (
        <option key={st.stationId} value={st.stationId}>{st.stationName}</option>
      ))}
    </select>
  );
}

// ── 속도 모니터링 교차로 선택 (검색 + 최대 3개 토글) ───────────────
export function SpeedDropdown({ options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();
  const inputRef = useRef();
  useCloseOnOutside(ref, () => { setOpen(false); setQuery(""); });

  const filtered = options.filter(o => o.name.includes(query));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 50); }} style={{
        background: "var(--field-bg)", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink0,
        fontFamily: V.sans, fontSize: 13, fontWeight: 600, padding: "7px 30px 7px 14px",
        cursor: "pointer", minWidth: 220, textAlign: "left", position: "relative",
      }}>
        {selected.length > 0 ? selected.map(s => s.name).join(", ") : "교차로 선택 (최대 3개)"}
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: V.ink2 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 200, background: "var(--field-bg)", border: `1px solid ${V.line}`, borderRadius: 2, minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${V.line}` }}>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="교차로 검색..."
              style={{ width: "100%", background: "var(--field-bg-sel)", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink0, fontSize: 13, padding: "6px 10px", fontFamily: V.sans, outline: "none" }} />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0
              ? <div style={{ padding: "14px", fontSize: 13, color: V.ink2, textAlign: "center" }}>검색 결과 없음</div>
              : filtered.map((opt, i) => {
                  const isSel = selected.some(s => s.id === opt.id);
                  return (
                    <div key={opt.id} onClick={() => onToggle(opt)}
                      style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        background: isSel ? "var(--field-bg-sel)" : "transparent", borderBottom: `1px solid ${V.line}`,
                        color: isSel ? V.ink0 : V.ink1, fontSize: 13, fontWeight: isSel ? 600 : 400 }}>
                      <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, minWidth: 28 }}>#{i + 1}</span>
                      <span style={{ flex: 1 }}>{opt.name}</span>
                      {isSel && <span style={{ color: V.blu, fontSize: 11 }}>✓</span>}
                    </div>
                  );
                })
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── 관심 교차로 검색/등록 ──────────────────────────────────────────
// selectedIdx === -1 또는 watchIds 존재 → "등록 모드" (+/✓ 토글)
// selectedIdx >= 0 → "선택 모드" (클릭 시 바로 닫힘)
export function RiskDropdown({ options, selectedIdx, onChange, watchIds = [] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();
  const inputRef = useRef();
  useCloseOnOutside(ref, () => { setOpen(false); setQuery(""); });

  const isRegisterMode = watchIds.length > 0 || selectedIdx === -1;
  const filtered = options.map((o, i) => ({ ...o, origIdx: i })).filter(o => o.name.includes(query));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 50); }} style={{
        background: "var(--field-bg)", border: `1px solid ${V.line}`, borderRadius: 999, color: V.ink0,
        fontFamily: V.sans, fontSize: 13, fontWeight: 600, padding: "8px 32px 8px 14px",
        cursor: "pointer", minWidth: 220, textAlign: "left", position: "relative",
      }}>
        {isRegisterMode ? "교차로 검색 후 등록" : options[selectedIdx] ? `${options[selectedIdx].name}` : "교차로 선택"}
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: V.ink2 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 200, background: "var(--field-bg)", border: `1px solid ${V.line}`, borderRadius: 2, minWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${V.line}` }}>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="교차로 검색..."
              style={{ width: "100%", background: "var(--field-bg-sel)", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink0, fontSize: 13, padding: "6px 10px", fontFamily: V.sans, outline: "none" }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {filtered.length === 0
              ? <div style={{ padding: "14px", fontSize: 13, color: V.ink2, textAlign: "center" }}>검색 결과 없음</div>
              : filtered.map((opt) => {
                  const color = riskColor(opt.score, opt.grade);
                  const isWatched = watchIds.includes(opt.id);
                  const isSel = opt.origIdx === selectedIdx;
                  return (
                    <div key={opt.name + opt.origIdx}
                      onClick={() => { onChange(opt.origIdx); if (!isRegisterMode) { setOpen(false); setQuery(""); } }}
                      style={{ padding: "11px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        background: isSel || isWatched ? "var(--field-bg-sel)" : "transparent", borderBottom: `1px solid ${V.line}`,
                        color: isSel || isWatched ? V.ink0 : V.ink1, fontSize: 13 }}>
                      <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, minWidth: 28 }}>#{opt.origIdx + 1}</span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{opt.name}</span>
                      <span style={{ fontFamily: V.mono, fontSize: 13, color, fontWeight: 700 }}>{hasRiskScore(opt.score) ? `${opt.score}점` : "—"}</span>
                      <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, minWidth: 36 }}>({riskLevel(opt.score, opt.grade)})</span>
                      {isRegisterMode && (
                        <span style={{ fontFamily: V.mono, fontSize: 11, color: isWatched ? V.grn : V.ink3, minWidth: 18, textAlign: "center" }}>
                          {isWatched ? "✓" : "+"}
                        </span>
                      )}
                    </div>
                  );
                })
            }
          </div>
        </div>
      )}
    </div>
  );
}
