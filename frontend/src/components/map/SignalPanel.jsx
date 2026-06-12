import { useState, useEffect } from "react";
import { clampRiskPercent, formatRiskScore, riskColorByGrade, statusCls } from "../../utils/signalUtils";

// ── 방향 레이블 상수 ──────────────────────────────────────────────────────────
// V2X API 키(nt/et/st/wt...)를 signalUtils.mapKeys()로 변환한 후
// SignalPanel에서 표시할 방향 이름/화살표 매핑
// (DirCard에서 직접 사용하지 않고 레이아웃 구성 참고용으로 정의)
const DIR_LABELS = [
  { dir: "north", label: "북", arrow: "↑" },
  { dir: "east",  label: "동", arrow: "→" },
  { dir: "south", label: "남", arrow: "↓" },
  { dir: "west",  label: "서", arrow: "←" },
];

// ── 신호 종류 상수 ────────────────────────────────────────────────────────────
// V2X API SignalDirection 객체의 필드명 → 표시 라벨 매핑
// key: SignalDirection의 속성명 (stsg=직진, ltsg=좌회전, pdsg=보행자)
// DirCard에서 d[key] 존재 여부로 실제 데이터 있는 신호만 렌더링
const SIGNAL_TYPES = [
  { key: "stsg", label: "직진" },
  { key: "ltsg", label: "좌회전" },
  { key: "pdsg", label: "보행" },
];

// 방향별 진입 속도 색상 (백엔드 혼잡도 기준과 동일: 정체<15, 서행<25, 원활).
function speedColor(speed) {
  if (!Number.isFinite(speed)) return "#6b7280";
  if (speed < 15) return "#ef4444";
  if (speed < 25) return "#f59e0b";
  return "#22c55e";
}

// ── TrafficLight ──────────────────────────────────────────────────────────────
/**
 * 신호등 1개 컴포넌트
 * 빨/노/초 3구 하우징 + 실시간 카운트다운 표시
 *
 * 신호 상태 판별:
 *   statusCls("protected-Movement-Allowed") → "green"
 *   statusCls("stop-And-Remain")            → "red"
 *   그 외                                   → "gray" (노란불)
 *
 * 카운트다운 계산:
 *   rmndCs: API 잔여 데시초 (300 = 30초)
 *   elapsed: totDt 기준 경과 초 (SignalPanel useEffect에서 0.1초마다 증가)
 *   remaining = max(0, rmndCs / 10 - elapsed) → 음수 방지 클램핑
 *
 * @param {string} status  - API 신호 상태값 ("protected-Movement-Allowed" 등)
 * @param {number} rmndCs  - 잔여 데시초 (÷10 하면 초)
 * @param {number} elapsed - 마지막 데이터 수신 후 경과 시간(초)
 */
function TrafficLight({ status, rmndCs, elapsed }) {
  const cls     = statusCls(status); // "green" | "red" | "gray"
  const isGreen = cls === "green";
  const isRed   = cls === "red";

  // 잔여시간 - 경과시간 = 실제 남은 시간 (0 미만은 0으로 클램핑)
  const remaining = rmndCs != null ? Math.max(0, rmndCs / 10 - elapsed) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>

      {/* 신호등 하우징: 어두운 케이스에 3개 원형 등 세로 배치 */}
      {/* <div style={{
        background: "#111",
        border: "2px solid #333",
        borderRadius: 8,
        padding: "6px 0",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
        width: 28, flexShrink: 0,
      }}> */}
      <div style={{
        background: "linear-gradient(180deg, #1b2330 0%, #070b12 100%)",
        border: "2px solid rgba(226,232,240,0.38)",
        borderRadius: 9,
        padding: "6px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        width: 30,
        flexShrink: 0,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.85), 0 4px 12px rgba(0,0,0,0.65)",
      }}>

        {/* 빨간불: isRed일 때만 밝은 빨강 + glow, 꺼진 상태는 매우 어두운 빨강 */}
        {/* <div style={{
          width: 16, height: 16, borderRadius: "50%",
          background: isRed ? "#ef4444" : "#3f1010",
          boxShadow: isRed ? "0 0 8px #ef4444" : "none",
          transition: "all 0.3s", // 신호 전환 시 부드럽게 변화
        }} /> */}
        <div style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: isRed ? "#ff3b3b" : "#2a0b0b",
          boxShadow: isRed ? "0 0 10px #ff3b3b, 0 0 18px rgba(255,59,59,0.55)" : "none",
          border: isRed ? "3px solid rgba(255,255,255,0.22)" : "3px solid rgba(239,68,68,0.35)",
          transition: "all 0.3s",
        }} />

        {/* 노란불: 초록도 빨강도 아닐 때 (gray 상태, 전환 중간) */}
        {/* <div style={{
          width: 16, height: 16, borderRadius: "50%",
          background: (!isRed && !isGreen) ? "#f59e0b" : "#3f3010",
          boxShadow: (!isRed && !isGreen) ? "0 0 8px #f59e0b" : "none",
          transition: "all 0.3s",
        }} /> */}
        <div style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: (!isRed && !isGreen) ? "#ffb020" : "#2b210b",
          boxShadow: (!isRed && !isGreen) ? "0 0 10px #ffb020, 0 0 18px rgba(255,176,32,0.5)" : "none",
          border: (!isRed && !isGreen) ? "3px solid rgba(255,255,255,0.22)" : "3px solid rgba(245,158,11,0.35)",
          transition: "all 0.3s",
        }} />

        {/* 초록불: isGreen일 때만 밝은 초록 + glow */}
        {/* <div style={{
          width: 16, height: 16, borderRadius: "50%",
          background: isGreen ? "#22c55e" : "#0a2810",
          boxShadow: isGreen ? "0 0 8px #22c55e" : "none",
          transition: "all 0.3s",
        }} /> */}
        <div style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: isGreen ? "#20e070" : "#082414",
          boxShadow: isGreen ? "0 0 10px #20e070, 0 0 18px rgba(32,224,112,0.55)" : "none",
          border: isGreen ? "3px solid rgba(255,255,255,0.22)" : "3px solid rgba(34,197,94,0.35)",
          transition: "all 0.3s",
        }} />

      </div>

      {/* 남은 시간 카운트다운 (rmndCs가 null이면 표시 안 함) */}
      {remaining != null && (
        <div style={{
          fontSize: 13, fontWeight: 800, fontFamily: "monospace",
          // 신호 상태에 따라 숫자 색상도 맞춤
          color: isGreen ? "#22c55e" : isRed ? "#ef4444" : "#6b7280",
        }}>
          {remaining.toFixed(1)}s
        </div>
      )}
    </div>
  );
}

// ── DirCard ───────────────────────────────────────────────────────────────────
/**
 * 방향별 신호 카드 컴포넌트
 * 북/동/남/서/북동/북서/남동/남서 중 한 방향의 신호 정보를 표시
 * 해당 방향 데이터가 없으면 null 반환 → 렌더링 자체 안 함
 *
 * 실제 데이터 있는 신호 종류만 표시:
 *   직진만 있으면 TrafficLight 1개
 *   직진 + 좌회전이면 2개
 *   직진 + 좌회전 + 보행이면 3개
 *
 * @param {string} dir     - 방향 키 ("north" | "east" | "south" | "west" 등)
 * @param {string} label   - 표시할 방향 이름 ("북" | "동" 등)
 * @param {string} arrow   - 방향 화살표 문자 ("↑" | "→" 등)
 * @param {Object} signals - mappedSignals 전체 객체 (모든 방향 포함)
 * @param {number} elapsed - TrafficLight에 전달할 경과 시간
 */
function DirCard({ dir, label, arrow, signals, speeds, elapsed }) {
  // 해당 방향의 SignalDirection 객체 추출
  // SignalDirection: { stsg, ltsg, pdsg, utsg, bssg, bcsg } 각각 DirectionSignal | null
  const d = signals?.[dir];
  if (!d) return null; // 데이터 없는 방향은 아예 렌더링 안 함 (레이아웃 공백 방지)

  // 실제 데이터가 있는 신호 종류만 필터링 (d[key]가 null/undefined면 제외)
  const activeSigs = SIGNAL_TYPES.filter(({ key }) => !!d[key]);

  // 이 방향으로 교차로에 진입하는 도로의 실시간 속도(km/h). 없으면 수집 중.
  const speed = speeds?.[dir];
  const hasSpeed = Number.isFinite(speed);

  return (
    <div style={{
      background: "rgba(18,16,10,0.75)",
      border: "1px solid rgba(42,36,24,0.8)",
      borderRadius: 8, padding: "10px 8px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      flex: 1, minWidth: 0, overflow: "hidden", // 같은 행의 카드들이 균등한 너비 차지
    }}>
      {/* 방향 라벨: 화살표 + 방향명 */}
      <div style={{ fontSize: 15, fontWeight: 800, color: "#4ea6ff", lineHeight: 1.1 }}>
        {arrow} {label}
      </div>

      {/* 신호 종류별 TrafficLight 가로 나열 */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "center", maxWidth: "100%" }}>
        {activeSigs.map(({ key, label: sLabel }) => {
          const sig = d[key]; // DirectionSignal { status, rmndCs }
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
              {/* 신호등 그래픽 + 카운트다운 */}
              <TrafficLight
                status={sig.status}   // "protected-Movement-Allowed" 등
                rmndCs={sig.rmndCs}   // 잔여 데시초
                elapsed={elapsed}     // 경과 시간 (실시간 차감용)
              />
              {/* 신호 종류 라벨 (직진 / 좌회전 / 보행) */}
              <div style={{ fontSize: 13, color: "#9ca3af", whiteSpace: "nowrap" }}>{sLabel}</div>
            </div>
          );
        })}
      </div>

      {/* 이 방향 진입 속도 (TOPIS 진입 링크 기준) */}
      <div style={{
        display: "flex", alignItems: "baseline", gap: 3,
        borderTop: "1px solid rgba(42,36,24,0.8)", paddingTop: 6, marginTop: 2,
      }}>
        {hasSpeed ? (
          <>
            <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: speedColor(speed) }}>
              {speed}
            </span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>km/h 진입</span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "#4b5563" }}>속도 수집 중</span>
        )}
      </div>
    </div>
  );
}

// ── SignalPanel (메인 컴포넌트) ───────────────────────────────────────────────
/**
 * 선택된 교차로의 방향별 신호 현황 패널
 * MapDashboard 지도 좌하단 오버레이에 표시
 *
 * 레이아웃 (십자가 형태):
 *   [북서] [북] [북동]
 *   [서]  [중앙]  [동]
 *   [남서] [남] [남동]
 *
 * 각 행은 데이터가 있는 방향이 하나라도 있을 때만 렌더링
 * 가운데 행(서/동)과 중앙 박스는 항상 표시
 *
 * elapsed 카운트다운 메커니즘:
 *   totDt 변경 시 (새 V2X 데이터 수신) → elapsed 0 리셋
 *   이후 0.1초마다 elapsed += 0.1 → TrafficLight에서 remaining 실시간 차감
 *
 * @param {Object} cr - 선택된 교차로 데이터
 *   cr.mappedSignals - { north: SignalDirection, east: ..., ... } (signalUtils.mapKeys 변환 후)
 *   cr.riskScore     - 도로위험도 API anals_value
 *   cr.riskGrade     - 도로위험도 API anals_grd
 *   cr.crsrdNm       - 교차로 이름
 *   cr.totDt         - API 수집 시각 ("20260511181500" 형식)
 */
export default function SignalPanel({ cr }) {
  // elapsed: 마지막 데이터 수신 후 경과 시간 (초 단위, 소수점 1자리)
  const [elapsed, setElapsed] = useState(0);

  // mappedSignals: signalUtils.mapKeys()가 변환한 방향별 신호 맵
  // 원본 API 키 nt/et/st/wt → north/east/south/west 로 이미 변환됨
  const s = cr.mappedSignals || {};
  // speedByDirection: 방향별 진입 속도 맵 (키는 signals와 동일하게 north/east/... 로 변환됨)
  const spd = cr.speedByDirection || {};

  // totDt 포맷 변환: "20260511181500" → "2026-05-11 18:15"
  const t = cr.totDt;
  const ts = t
    ? `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)} ${t.slice(8,10)}:${t.slice(10,12)}`
    : "-";
  const riskGradeColor = riskColorByGrade(cr.riskGrade);
  const riskPct = clampRiskPercent(cr.riskScore);
  const riskText = Number.isFinite(cr.riskScore) ? formatRiskScore(cr.riskScore) : "대기";

  // ── elapsed 카운트다운 ──────────────────────────────────────────────────────
  // totDt가 바뀔 때 (새 신호 데이터 수신 시) elapsed를 0으로 리셋하고 다시 증가
  // 의존성 배열: [cr.totDt] → 같은 교차로 재선택이 아닌 실제 신호 변경 시만 리셋
  useEffect(() => {
    setElapsed(0); // 새 데이터 수신 → 카운트다운 리셋
    const id = setInterval(() => setElapsed(e => e + 0.1), 100); // 100ms마다 0.1초 증가
    return () => clearInterval(id); // 언마운트 또는 totDt 변경 시 인터벌 정리
  }, [cr.totDt]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", overflow: "hidden" }}>

      {/* API 수집 시각 표시 */}
      <div style={{ fontSize: 13, color: "#64748b" }}>API 수집: {ts}</div>

      {/* ── 북쪽 행: 북서 / 북 / 북동 ──────────────────────────────────────── */}
      {/* 셋 중 하나라도 데이터 있을 때만 행 전체 렌더 */}
      {(s.north || s.northeast || s.northwest) && (
        <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
          {s.northwest && <DirCard dir="northwest" label="북서" arrow="↖" signals={s} speeds={spd} elapsed={elapsed} />}
          {s.north     && <DirCard dir="north"     label="북"   arrow="↑" signals={s} speeds={spd} elapsed={elapsed} />}
          {s.northeast && <DirCard dir="northeast" label="북동" arrow="↗" signals={s} speeds={spd} elapsed={elapsed} />}
        </div>
      )}

      {/* ── 가운데 행: 서 / 중앙 박스 / 동 ─────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
        <DirCard dir="west" label="서" arrow="←" signals={s} speeds={spd} elapsed={elapsed} />

        {/* 중앙 박스: 교차로 이름 + 위험도 도넛 차트 */}
        <div style={{
          width: 82, minWidth: 82, height: 94, flexShrink: 0,
          background: "rgba(18,16,10,0.75)",
          border: "1px solid rgba(42,36,24,0.8)",
          borderRadius: 8,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 6, padding: 6,
        }}>
          {/* 교차로 이름 (줄바꿈 허용, 한글 단어 단위 유지) */}
          <div style={{ fontSize: 13, color: "#60a5fa", fontWeight: 700, textAlign: "center", wordBreak: "keep-all", lineHeight: 1.3 }}>
            {cr.crsrdNm}
          </div>

          {/* 위험도 도넛 차트: CSS conic-gradient로 구현
              conic-gradient(색상 n%, 배경색 0) → n% 만큼 색상 채워진 원형
              안쪽 작은 원으로 덮어 도넛 모양 만들기
              색상은 위험도 API 등급(anals_grd), 숫자는 점수(anals_value)를 그대로 사용 */}
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: `conic-gradient(${riskGradeColor} ${riskPct}%, #1f2937 0)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* 안쪽 원 (도넛 구멍 역할) + 점수 텍스트 */}
            <div style={{
              width: 27, height: 27, borderRadius: "50%",
              background: "rgba(0,0,0,0.82)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: riskText.length > 4 ? 11 : 15, fontWeight: 700,
              color: riskGradeColor,
            }}>
              {riskText}
            </div>
          </div>
        </div>

        <DirCard dir="east" label="동" arrow="→" signals={s} speeds={spd} elapsed={elapsed} />
      </div>

      {/* ── 남쪽 행: 남서 / 남 / 남동 ──────────────────────────────────────── */}
      {/* 셋 중 하나라도 데이터 있을 때만 행 전체 렌더 */}
      {(s.south || s.southeast || s.southwest) && (
        <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
          {s.southwest && <DirCard dir="southwest" label="남서" arrow="↙" signals={s} speeds={spd} elapsed={elapsed} />}
          {s.south     && <DirCard dir="south"     label="남"   arrow="↓" signals={s} speeds={spd} elapsed={elapsed} />}
          {s.southeast && <DirCard dir="southeast" label="남동" arrow="↘" signals={s} speeds={spd} elapsed={elapsed} />}
        </div>
      )}
    </div>
  );
}
