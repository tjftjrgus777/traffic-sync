import { V } from "../../constants/theme";
import { clampRiskPercent, formatRiskScore, riskColorByGrade, riskLabelByGrade } from "../../utils/signalUtils";

export default function RiskList({ risks, onSelect, crossroadsCount }) {
  return (
    <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "14px 16px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: V.ink0 }}>
        ⚠️ <span style={{ color: V.org }}>사고 위험 도로</span>
      </div>
      {risks.length === 0
        ? <div style={{ fontSize: 13, color: V.ink3, textAlign: "center", padding: "10px 0" }}>{crossroadsCount === 0 ? "수신 대기 중..." : "위험 없음 ✓"}</div>
        : risks.map(cr => {
          const color = riskColorByGrade(cr.riskGrade);
          const scoreText = formatRiskScore(cr.riskScore);
          return (
            <div key={cr.crsrdId} onClick={() => onSelect(cr)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 2, marginBottom: 6,
                background: "transparent", border: `1px solid ${V.line}`, cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg2)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color, marginRight: 8 }}>
                  {riskLabelByGrade(cr.riskGrade)} {scoreText === "수집 대기" ? scoreText : `${scoreText}점`}
                </span>
                <span style={{ fontSize: 13, color: V.ink0 }}>{cr.crsrdNm}</span>
              </div>
              <div style={{ width: 52, height: 4, borderRadius: 2, background: V.line, overflow: "hidden" }}>
                <div style={{ width: `${clampRiskPercent(cr.riskScore)}%`, height: "100%", background: color }} />
              </div>
            </div>
          );
        })
      }
    </div>
  );
}
