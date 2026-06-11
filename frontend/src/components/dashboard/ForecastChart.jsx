/**
 * 24시간 상행/하행 교통량 예측 막대 차트
 * 피크 시간대(최대값)에 흰색 outline으로 강조한다.
 *
 * @param {number[]} up    상행 0~23시 교통량 배열 (대/시)
 * @param {number[]} down  하행 0~23시 교통량 배열 (대/시)
 * @param {string}   name  교차로/지점 이름
 */
import { V } from "../../constants/theme";

export default function ForecastChart({ up = [], down = [], name }) {
  const all = [...up, ...down];
  const maxVal = all.length ? Math.max(...all, 1) : 1;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const peakUp = up.length ? up.indexOf(Math.max(...up)) : -1;       // 상행 피크 시간
  const peakDn = down.length ? down.indexOf(Math.max(...down)) : -1; // 하행 피크 시간
  const axisVals = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      {/* 헤더: 지점명 + 상행/하행 피크 요약 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: "12px 14px" }}>
        <div>
          <div style={{ fontSize: 15, color: V.ink0, fontWeight: 700 }}>
            <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>▪</span>{name || "—"}
          </div>
          <div style={{ fontSize: 11, color: V.ink2, fontFamily: V.mono, marginTop: 3 }}>상행/하행 0시–23시 예측 (대/시)</div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {[{ label: "상행 피크", sw: V.blu, val: up.length ? Math.max(...up) : "—", h: peakUp >= 0 ? `${peakUp}시` : "" },
            { label: "하행 피크", sw: "#ff8e55", val: down.length ? Math.max(...down) : "—", h: peakDn >= 0 ? `${peakDn}시` : "" }
          ].map(s => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: V.ink1 }}>
              <span style={{ width: 14, height: 3, borderRadius: 1, background: s.sw, display: "inline-block" }} />
              <span style={{ fontSize: 11, color: V.ink2 }}>{s.label}</span>
              <b style={{ fontFamily: V.mono, color: V.ink0, fontSize: 14, fontWeight: 700 }}>{s.val}</b>
              {s.h && <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2 }}>· {s.h}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 차트 본체 */}
      <div style={{ display: "flex", flex: 1, minHeight: 200 }}>
        {/* Y축 레이블 */}
        <div style={{ width: 44, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "6px 8px 28px 0", fontFamily: V.mono, fontSize: 11, color: V.ink2, borderRight: `1px dashed ${V.line}`, textAlign: "right" }}>
          {axisVals.map((v, i) => <span key={i}>{v}</span>)}
        </div>
        <div style={{ flex: 1, position: "relative", paddingTop: 6 }}>
          {/* 수평 그리드 라인 */}
          {[0, 25, 50, 75].map(p => (
            <div key={p} style={{ position: "absolute", left: 0, right: 0, height: 1, background: "var(--grid)", top: `${p}%`, pointerEvents: "none" }} />
          ))}
          <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: V.line, bottom: 28 }} />
          {/* 막대: 24시간 × 상행/하행 */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 6, bottom: 28, display: "grid", gridTemplateColumns: "repeat(24,1fr)", alignItems: "flex-end" }}>
            {hours.map(h => {
              const u = up[h] ?? 0, d = down[h] ?? 0;
              const uH = (u / maxVal) * 100, dH = (d / maxVal) * 100;
              return (
                <div key={h} style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 1, height: "100%", padding: "0 1px" }}>
                  {/* 상행(파랑) — 피크는 흰 outline */}
                  <div style={{ width: 6, height: `${uH}%`, minHeight: uH > 0 ? 2 : 0, background: V.blu, borderRadius: "1px 1px 0 0", outline: h === peakUp ? `1px solid ${V.ink2}` : "none" }} />
                  {/* 하행(주황) */}
                  <div style={{ width: 6, height: `${dH}%`, minHeight: dH > 0 ? 2 : 0, background: "#ff8e55", borderRadius: "1px 1px 0 0", outline: h === peakDn ? `1px solid ${V.ink2}` : "none" }} />
                </div>
              );
            })}
          </div>
          {/* X축 시간 레이블 (00~23) */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, display: "grid", gridTemplateColumns: "repeat(24,1fr)", fontFamily: V.mono, fontSize: 10, color: V.ink2, textAlign: "center" }}>
            {hours.map(h => (
              <span key={h} style={{ paddingTop: 4, color: h === peakUp || h === peakDn ? V.ink0 : V.ink2, fontWeight: h === peakUp || h === peakDn ? 700 : 400 }}>
                {String(h).padStart(2, "0")}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
