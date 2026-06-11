/**
 * 상단 KPI 수치 카드
 * 큰 숫자 + 단위 + 라벨 + 상태 배지로 구성된다.
 * status 값에 따라 배지 색이 자동 결정된다 (심각=빨강, 위험/서행/피크/주의=주황, 그 외=회색).
 *
 * @param {number|string} value   표시할 수치
 * @param {string}        unit    단위 (개, km/h, 점 등)
 * @param {string}        label   항목 이름
 * @param {string}        sub     보조 설명
 * @param {string}        status  상태 배지 텍스트
 */
import { V } from "../../constants/theme";

export default function KpiCard({ value, unit, label, sub, status }) {
  const s = status === "심각" ? { c: V.red, bg: "#1a0a10", bd: "#3a1820" }
    : (status === "위험" || status === "서행" || status === "피크" || status === "주의")
      ? { c: V.org, bg: "#1a1206", bd: "#3a2a14" }
      : { c: V.ink1, bg: V.bg0, bd: V.line };

  return (
    <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "14px 18px", position: "relative", minHeight: 96 }}>
      {status && (
        <span style={{ fontFamily: V.mono, fontSize: 11, fontWeight: 700, color: s.c, position: "absolute", top: 14, right: 16 }}>
          {status}
        </span>
      )}
      <div style={{ fontFamily: V.mono, fontWeight: 700, fontSize: 44, color: V.ink0, letterSpacing: "-1.8px", lineHeight: 1, display: "flex", alignItems: "baseline", gap: 4 }}>
        {value}<span style={{ fontSize: 12, color: V.ink2, fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 15, color: V.ink0, fontWeight: 600, marginTop: 7 }}>{label}</div>
      <div style={{ fontSize: 12, color: V.ink2, fontFamily: V.mono, marginTop: 3 }}>{sub}</div>
    </div>
  );
}
