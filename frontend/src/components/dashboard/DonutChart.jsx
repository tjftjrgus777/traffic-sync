/**
 * 위험도 도넛 차트
 * SVG strokeDasharray로 원형 진행률을 그린다.
 * 색상은 위험도 등급, 숫자는 점수를 그대로 사용한다.
 *
 * @param {string} name   교차로 이름 (중앙 표시)
 * @param {number} score  위험도 점수
 * @param {string} grade  위험도 등급
 */
import { V } from "../../constants/theme";
import { hasRiskScore, riskColor, riskLevel, riskPercent } from "../../utils/riskUtils";

export default function DonutChart({ name, score, grade }) {
  const ready = hasRiskScore(score);
  const color = riskColor(score, grade);
  const level = riskLevel(score, grade);
  const r = 80, sw = 18;              // 반지름, 선 굵기
  const circ = 2 * Math.PI * r;       // 원 둘레
  const dash = ready ? (riskPercent(score) / 100) * circ : 0; // 채워질 길이

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: 10, minHeight: 300 }}>
      <svg viewBox="0 0 220 220" style={{ width: "100%", maxHeight: 260, display: "block" }}>
        {/* 배경 트랙 */}
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--grid)" strokeWidth={sw} />
        {/* 진행률 원 (-90도 회전해 12시 방향부터 시작) */}
        <circle cx="110" cy="110" r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 110 110)" />
      </svg>
      {/* 중앙 텍스트 오버레이 */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: V.ink0, marginBottom: 6 }}>{name || "—"}</div>
        <div style={{ fontFamily: V.mono, fontWeight: 700, fontSize: 72, color: V.ink0, letterSpacing: "-3px", lineHeight: 1 }}>
          {ready ? score : "—"}<span style={{ fontSize: 15, color: V.ink2, fontWeight: 500, marginLeft: 3 }}>점</span>
        </div>
        <div style={{ marginTop: 8, fontFamily: V.mono, fontSize: 13, color, fontWeight: 700 }}>{level}</div>
      </div>
    </div>
  );
}
