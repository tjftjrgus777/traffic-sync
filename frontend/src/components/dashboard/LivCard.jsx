/**
 * 실시간 구간 속도 카드
 * 현재 속도 + 추세(▲▼) + Sparkline 히스토리 + 통계(관측수/윈도우평균/최소최대)를 보여준다.
 *
 * @param {string}   name       교차로 이름
 * @param {string}   color      카드 고유 색상
 * @param {number}   speed      현재 속도 (km/h)
 * @param {number[]} sparkData  속도 히스토리 배열
 */
import { V } from "../../constants/theme";
import { statusOf } from "../../utils/riskUtils";
import Sparkline from "./Sparkline";

export default function LivCard({ name, color, speed, sparkData }) {
  const st = speed != null ? statusOf(speed) : "—";
  const stColor = st === "혼잡" ? V.red : st === "서행" ? V.org : st === "원활" ? V.grn : V.ink2;
  const cnt = sparkData?.length ?? 0;

  // 최근 10개 평균 (슬라이딩 윈도우)
  const winAvg = cnt > 0 ? Math.round(sparkData.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, cnt)) : null;
  const mn = cnt > 0 ? Math.round(Math.min(...sparkData)) : null;
  const mx = cnt > 0 ? Math.round(Math.max(...sparkData)) : null;
  // 최근 6포인트 대비 현재값의 변화량 (추세 화살표)
  const trend = cnt >= 2 ? Math.round(sparkData[cnt - 1] - sparkData[Math.max(0, cnt - 6)]) : null;

  return (
    <div style={{ background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: "16px 18px 12px", display: "flex", flexDirection: "column", gap: 10, minHeight: 200 }}>
      {/* 헤더: 색상 막대 + 교차로명 + 상태 배지 */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <span style={{ display: "inline-block", width: 14, height: 3, background: color, borderRadius: 1, marginRight: 9 }} />
        <span style={{ color: V.ink0, fontSize: 17, fontWeight: 600 }}>{name}</span>
        <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 11, color: stColor, fontWeight: 700 }}>{st}</span>
      </div>
      {/* 속도 수치 + 추세 */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: V.mono, flexShrink: 0 }}>
        <span style={{ fontSize: 54, fontWeight: 700, color: V.ink0, lineHeight: 1, letterSpacing: "-1px" }}>{speed ?? "—"}</span>
        <span style={{ fontSize: 16, color: V.ink2 }}>km/h</span>
        {trend !== null && (
          <span style={{ marginLeft: "auto", fontSize: 13, color: trend >= 0 ? V.grn : V.red }}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)} km/h
          </span>
        )}
      </div>
      {/* Sparkline (남은 공간 채움) */}
      <div style={{ flex: 1, minHeight: 64 }}>
        {sparkData && sparkData.length > 1
          ? <Sparkline values={sparkData} color={color} />
          : <div style={{ height: "100%", border: `1px dashed ${V.line}`, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a6378", fontFamily: V.mono, fontSize: 11 }}>SPARKLINE · 대기 중</div>
        }
      </div>
      {/* 하단 통계 바 */}
      <div style={{ display: "flex", gap: 12, fontFamily: V.mono, fontSize: 11, color: V.ink2, paddingTop: 6, borderTop: `1px solid ${V.line}`, flexShrink: 0 }}>
        <span>{cnt}관측</span>
        <span>윈도우 평균 <b style={{ color: V.ink1 }}>{winAvg ?? "—"} km/h</b></span>
        <span>최소·최대 <b style={{ color: V.ink1 }}>{mn ?? "—"} / {mx ?? "—"} km/h</b></span>
      </div>
    </div>
  );
}
