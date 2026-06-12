import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { GU_LIST, calcDistKm } from "../constants/seoulGeoData";
import SeoulSvgMap from "../components/map/SeoulSvgMap";
import ReActToastContainer, { triggerReActToast } from "../components/common/ReActToast";
import AppHeader from "../components/common/AppHeader";

// 스프링 REST API 주소 (.env의 VITE_API_URL)
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const OLD_SPARK_HISTORY_KEY = "traffic-sync:spark-history:v1";
const SPARK_RUNTIME_VERSION = "visible-card-baseline:v1";
const SPARK_MAX_SAMPLES = 720;
const SPARK_SAMPLE_INTERVAL_MS = 5000;

// ── 전역 색상/폰트 디자인 토큰 ──────────────────────────────────────────────
// 컴포넌트 인라인 스타일에서 일관된 색상을 쓰기 위한 상수 맵
// const V = {
//   bg0: "#000", bg1: "#0a0a0a", line: "#1a1a1a",       // 배경/구분선
//   ink0: "#e7ecf5", ink1: "#aab4c8", ink2: "#7a7a7a", ink3: "#3a3a3a",  // 텍스트 단계
//   grn: "#2ee07a", yel: "#facc15", red: "#ff5566", org: "#ffaa33", blu: "#4ea6ff",       // 상태 색상
//   mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
//   sans: "'Pretendard','Noto Sans KR','Malgun Gothic',system-ui,sans-serif",
// };


const V = {
  bg0: "#03060a",        // 전체 배경: 거의 검정
  bg1: "#0c131d",        // 큰 패널 배경: 기존보다 살짝 푸른 어둠
  bg2: "#121c2a",        // 내부 카드 배경: 카드가 확실히 보이게
  bg3: "#172437",        // 선택/강조 카드 배경   
  line: "#3f506a",      // 기본 테두리: 카드 분리감
  line2: "#5a7193",    // KPI 같은 강조 카드 테두리

  ink0: "#f7faff",
  ink1: "#d2dbea",
  ink2: "#9aa8bb",
  ink3: "#657386",

  grn: "#2ee07a",
  yel: "#facc15",
  red: "#ff5566",
  org: "#ffaa33",
  blu: "#4ea6ff",

  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR','Malgun Gothic',system-ui,sans-serif",
};

// const panelStyle = {
//   background: `linear-gradient(180deg, ${V.bg1} 0%, #070b11 100%)`,
//   border: `1px solid ${V.line}`,
//   borderRadius: 6,
//   boxShadow: "0 0 0 1px rgba(255,255,255,0.025), 0 14px 34px rgba(0,0,0,0.42)",
// };
const panelStyle = {
  background: `linear-gradient(180deg, ${V.bg1} 0%, #070b11 100%)`,
  border: `1px solid ${V.line}`,
  borderRadius: 6,
  boxShadow: `
    0 0 0 1px rgba(78,166,255,0.08),
    0 14px 34px rgba(0,0,0,0.46)
  `,
};

// const panelHeaderStyle = {
//   display: "flex",
//   alignItems: "center",
//   gap: 10,
//   padding: "10px 13px",
//   borderBottom: `1px solid ${V.line}`,
//   background: "rgba(16,24,38,0.92)",
//   flexShrink: 0,
// };
const panelHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 13px",
  borderBottom: `1px solid ${V.line}`,
  background: "linear-gradient(180deg, rgba(20,31,47,0.95), rgba(11,17,26,0.95))",
  flexShrink: 0,
};

// const innerCardStyle = {
//   background: V.bg2,
//   border: `1px solid ${V.line}`,
//   borderRadius: 6,
//   boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
// };
const innerCardStyle = {
  background: `linear-gradient(180deg, ${V.bg2} 0%, #0b111a 100%)`,
  border: `1px solid ${V.line}`,
  borderRadius: 6,
  boxShadow: `
    inset 0 1px 0 rgba(255,255,255,0.045),
    0 8px 18px rgba(0,0,0,0.32)
  `,
};

// 위험도 API 점수는 100점을 넘을 수 있으므로 300점을 기준으로 게이지를 환산한다.
// 300점 이상은 게이지를 100%로 표시한다.
const RISK_MAX_SCORE = 300;

// ── BottleneckEmailBtn ──────────────────────────────────────────────────────
function BottleneckEmailBtn({ district, apiBase }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error

  const handleClick = () => {
    if (status === "loading") return;
    setStatus("loading");
    const userEmail = JSON.parse(localStorage.getItem("ts_user") || "{}").email || null;

    triggerReActToast({
      endpoint: "/api/agent/bottleneck-email/stream",
      body: { district, userEmail },
      onDone: () => {
        setStatus("done");
        setTimeout(() => setStatus("idle"), 3000);
      },
    });
  };

  const iconSrc =
    status === "loading" ? "/icons/mail_send.png" :
    status === "done" ? "/icons/mail_send.png" :
    status === "error" ? "/icons/mail.png" :
    "/icons/mail.png";
  

  // const label = status === "loading" ? "⏳" : status === "done" ? "📨" : status === "error" ? "❌" : "📧";
  const color = status === "done" ? "#2ee07a" : status === "error" ? "#ff5566" : "#4ea6ff";

  return (
    <button onClick={handleClick} disabled={status === "loading"} style={{
      fontSize: 15, padding: "6px 10px", borderRadius: 999, fontWeight: 500,
      // border: "1px solid #1a1a1a", 
      border: 0,
      background: "transparent",
      color: "#fff", cursor: status === "loading" ? "wait" : "pointer",
      fontFamily: "'Pretendard','Noto Sans KR','Malgun Gothic',system-ui,sans-serif", transition: "all 0.2s", boxShadow: "none", letterSpacing: "0"
    }}>
      {/* {label} */}
      <img src={iconSrc} alt="" style={{width: 18, height: 18, objectFit: "contain", filter: "invert(1)", opacity: status === "loading" ? 0.75 : 0.95, }} />
    </button>
  );
}

// ── makeSpark ───────────────────────────────────────────────────────────────
/**
 * 실시간 속도 히스토리 초기 배열 생성
 * 더미 랜덤값을 만들지 않고, 실제 API 속도가 들어온 경우에만 같은 값으로 시작한다.
 * @param {number} base  - 첫 속도값 (km/h)
 * @returns {number[]}   - 실제 속도 기반 초기 배열
 */
function makeSpark(base) {
  return Number.isFinite(base) ? [base] : [];
}

// ── makeForecast ─────────────────────────────────────────────────────────────
/**
 * 교차로별 24시간 교통량 예측 더미 데이터 생성
 * crsrdId를 seed로 사용해 같은 교차로는 항상 같은 패턴이 나오도록 재현 가능
 * 실제 /api/forecast API가 없거나 실패하면 이 더미를 그대로 표시
 *
 * @param {number} seed - crsrdId 숫자 부분 또는 인덱스
 * @returns {{ up: number[], down: number[] }} - 상행/하행 0~23시 대/시 배열
 */

// ── Sparkline ────────────────────────────────────────────────────────────────
/**
 * 미니 라인 차트 컴포넌트 (SVG polyline + 그라데이션 영역)
 * LivCard 하단에 삽입되어 속도 히스토리를 시각화
 *
 * @param {number[]} values - 속도 배열
 * @param {string}   color  - 선/영역 색상 hex
 */
function Sparkline({ values, color }) {
  if (!values || values.length === 0) return null;
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const W = 300, H = 100;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min;
  // 각 값을 SVG 좌표로 변환
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * W;
    const y = range === 0 ? H / 2 : H - ((v - min) / range) * (H - 6) - 3; // 위아래 3px 여백
    return `${x},${y}`;
  }).join(" ");
  const gradId = `sg${color.replace("#", "")}`; // 색상별 고유 gradient id

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%", display: "block" }} preserveAspectRatio="none">
      <defs>
        {/* 선 아래 반투명 영역 채우기 */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 채움 영역: 좌하단 → 데이터 포인트 → 우하단 */}
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${gradId})`} />
      {/* 실선 */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── KpiCard ──────────────────────────────────────────────────────────────────
/**
 * 상단 KPI 수치 카드
 * 큰 숫자 + 단위 + 라벨 + 상태 배지로 구성
 * status에 따라 배지 색상 자동 결정: 위험=빨강, 서행/피크=주황, 나머지=회색
 *
 * @param {number|string} value  - 표시할 수치
 * @param {string}        unit   - 단위 (개, km/h, 점 등)
 * @param {string}        label  - 항목 이름
 * @param {string}        sub    - 보조 설명
 * @param {string}        status - 상태 배지 텍스트 (위험|서행|피크|정상)
 */
function KpiCard({ value, unit, label, sub, status }) {
  // 상태별 배지 스타일
  const s = status === "심각" || status === "정체" ? { c: V.red, bg: "#1a0a10", bd: "#3a1820" }
    : status === "위험" || status === "서행" || status === "피크" || status === "주의" ? { c: V.org, bg: "#1a1206", bd: "#3a2a14" }
    : status === "원활" ? { c: V.grn, bg: "#0c1a12", bd: "#1a3a24" }
    : { c: V.ink1, bg: V.bg0, bd: V.line };
  return (
    <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "14px 18px", position: "relative", minHeight: 96 }}>
      {/* 우측 상단 상태 배지 */}
      {status && (
        <span style={{ fontFamily: V.mono, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 2, background: s.bg, border: `1px solid ${s.bd}`, color: s.c, position: "absolute", top: 14, right: 16 }}>
          {status}
        </span>
      )}
      {/* 큰 숫자 */}
      <div style={{ fontFamily: V.mono, fontWeight: 700, fontSize: 44, color: "#fff", letterSpacing: "-1.8px", lineHeight: 1, display: "flex", alignItems: "baseline", gap: 4 }}>
        {value}<span style={{ fontSize: 14, color: V.ink2, fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 15, color: V.ink0, fontWeight: 600, marginTop: 7 }}>{label}</div>
      <div style={{ fontSize: 12, color: V.ink2, fontFamily: V.mono, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

// ── statusOf ─────────────────────────────────────────────────────────────────
// 속도값 → 혼잡 상태 문자열 변환 유틸
// 15 미만: 정체, 15~25 미만: 서행, 25 이상: 원활
function statusOf(v) {
  if (v < 15) return "정체";
  if (v < 25) return "서행";
  return "원활";
}

function riskScoreValue(score) {
  const n = Number.parseFloat(score);
  return Number.isFinite(n) ? n : null;
}

function hasRiskScore(score) {
  return riskScoreValue(score) != null;
}

function riskGradeValue(grade) {
  const n = Number.parseInt(String(grade ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function hasRiskGrade(grade) {
  return riskGradeValue(grade) != null;
}

function riskPercent(score, maxScore = RISK_MAX_SCORE) {
  const value = riskScoreValue(score);
  if (value == null) return 0;
  return Math.max(0, Math.min(100, (value / maxScore) * 100));
}

function riskColor(score, grade) {
  switch (riskGradeValue(grade)) {
    case 1: return V.grn;
    case 2: return V.yel;
    case 3: return V.org;
    case 4: return V.red;
    default: return V.ink2;
  }
}

function riskLevel(score, grade) {
  switch (riskGradeValue(grade)) {
    case 1: return "안전";
    case 2: return "주의";
    case 3: return "위험";
    case 4: return "심각";
    default: return hasRiskScore(score) ? "등급 대기" : "수집 대기";
  }
}

function riskRank(item) {
  const grade = riskGradeValue(item?.riskGrade ?? item?.grade);
  const score = riskScoreValue(item?.riskScore ?? item?.score) ?? -1;
  return grade == null ? -1 : grade * 100000 + score;
}

// ── LivCard ──────────────────────────────────────────────────────────────────
/**
 * 실시간 구간 속도 카드
 * 현재 속도 + 추세(▲▼) + Sparkline 히스토리 + 통계(관측수·윈도우평균·최소최대)
 *
 * @param {string}   name      - 교차로 이름
 * @param {string}   color     - 카드 고유 색상 (CARD_COLORS 배열에서 할당)
 * @param {number}   speed     - 현재 속도 (km/h)
 * @param {number[]} sparkData - 속도 히스토리 배열 (sparkRef에서 가져옴)
 */
function LivCard({ name, color, speed, sparkData }) {
  const st = speed != null ? statusOf(speed) : "—";
  const stColor = st === "정체" ? V.red : st === "서행" ? V.org : st === "원활" ? V.grn : V.ink2;
  const cnt = sparkData?.length ?? 0;
  // 최근 10개 평균 (슬라이딩 윈도우)
  const winAvg = cnt > 0 ? Math.round(sparkData.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, cnt)) : null;
  const mn = cnt > 0 ? Math.round(Math.min(...sparkData)) : null;
  const mx = cnt > 0 ? Math.round(Math.max(...sparkData)) : null;
  // 이 카드의 첫 관측값 대비 현재 표시 속도 변화량.
  const currentSpeed = Number(speed);
  const baselineSpeed = cnt > 0 ? Number(sparkData[0]) : null;
  const trend = Number.isFinite(currentSpeed) && Number.isFinite(baselineSpeed)
    ? Math.round(currentSpeed - baselineSpeed)
    : null;
  const trendColor = trend == null || trend === 0 ? V.ink1 : trend > 0 ? V.grn : V.red;
  const trendIcon = trend == null || trend === 0 ? "━" : trend > 0 ? "▲" : "▼";
  const trendLabel = trend == null ? "" : `${trend > 0 ? "+" : ""}${trend} km/h`;

  return (
    // <div style={{ background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: "14px 16px 10px", display: "flex", flexDirection: "column", gap: 8, minHeight: 172 }}>
    <div style={{
      ...innerCardStyle,
      padding: "17px 18px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minHeight: 190,
    }}>
      {/* 헤더: 색상 막대 + 교차로명 + 상태 배지 */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <span style={{ display: "inline-block", width: 14, height: 3, background: color, borderRadius: 1, marginRight: 9 }} />
        {/* <span style={{ color: "#fff", fontSize: 17, fontWeight: 600 }}>{name}</span> */}
        <span style={{ color: "#fff", fontSize: 19, fontWeight: 800 }}>{name}</span>
        <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 11, color: stColor, padding: "3px 8px", border: `1px solid ${stColor}44`, borderRadius: 2 }}>{st}</span>
      </div>
      {/* 속도 수치 + 추세 */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: V.mono, flexShrink: 0 }}>
        {/* <span style={{ fontSize: 44, fontWeight: 700, color: "#fff", lineHeight: 1, letterSpacing: "-1px" }}>{speed ?? "—"}</span> */}
        <span style={{ fontSize: 48, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: "-1px" }}>{speed ?? "—"}</span>
        <span style={{ fontSize: 14, color: V.ink2 }}>km/h</span>
        {trend !== null && (
          <span style={{ marginLeft: "auto", fontSize: 13, color: trendColor }}>
            {trendIcon} {trendLabel}
          </span>
        )}
      </div>
      {/* Sparkline — flex:1로 남은 공간 꽉 채움 */}
      <div style={{ flex: 1, minHeight: 64 }}>
        {sparkData && sparkData.length > 0
          ? <Sparkline values={sparkData} color={color} />
          : <div style={{ height: "100%", border: `1px dashed ${V.line}`, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a6378", fontFamily: V.mono, fontSize: 11 }}>SPARKLINE · 대기 중</div>
        }
      </div>
      {/* 하단 통계 바 */}
      <div style={{ display: "flex", gap: 7, fontFamily: V.mono, fontSize: 10, color: V.ink2, paddingTop: 6, borderTop: `1px solid #141414`, flexShrink: 0 }}>
        <span>{cnt}관측</span>
        <span>윈도우 평균 <b style={{ color: V.ink1 }}>{winAvg ?? "—"} </b></span>
        <span>최소·최대 <b style={{ color: V.ink1 }}>{mn ?? "—"} / {mx ?? "—"}  (km/h)</b></span>
      </div>
    </div>
  );
}

// ── DonutChart ───────────────────────────────────────────────────────────────
/**
 * 위험도 도넛 차트
 * SVG strokeDasharray 기법으로 원형 진행률 표시
 * 색상은 위험도 API 등급(anals_grd), 숫자는 점수(anals_value)를 그대로 사용
 *
 * @param {string} name  - 교차로 이름 (중앙 표시)
 * @param {number} score - 위험도 API 점수
 * @param {string} grade - 위험도 API 등급
 */
function DonutChart({ name, score, grade }) {
  const ready = hasRiskScore(score);
  const color = riskColor(score, grade);
  const level = riskLevel(score, grade);
  const r = 80, sw = 18; // 반지름, 선 굵기
  const circ = 2 * Math.PI * r; // 원 둘레
  const dash = ready ? (riskPercent(score) / 100) * circ : 0; // 채워질 길이

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: 8, minHeight: 230 }}>
      <svg viewBox="0 0 220 220" style={{ width: "100%", maxHeight: 210, display: "block" }}>
        {/* 배경 트랙 (회색 원) */}
        <circle cx="110" cy="110" r={r} fill="none" stroke="#141414" strokeWidth={sw} />
        {/* 진행률 원: -90도 회전해서 12시 방향부터 시작 */}
        <circle cx="110" cy="110" r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 110 110)" />
      </svg>
      {/* 중앙 텍스트 오버레이 */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{name || "—"}</div>
        <div style={{ fontFamily: V.mono, fontWeight: 700, fontSize: 56, color: "#fff", letterSpacing: "-3px", lineHeight: 1 }}>
          {ready ? score : "—"}<span style={{ fontSize: 15, color: V.ink2, fontWeight: 500, marginLeft: 3 }}>점</span>
        </div>
        <div style={{ marginTop: 8, fontFamily: V.mono, fontSize: 13, padding: "4px 12px", borderRadius: 2, border: `1px solid ${color}`, color, background: `${color}20`, fontWeight: 700 }}>{level}</div>
      </div>
    </div>
  );
}

// ── ForecastChart ─────────────────────────────────────────────────────────────
/**
 * 24시간 상행/하행 교통량 예측 막대 차트
 * 피크 시간대(최대값)만 선명하게 표시하고, 나머지 막대는 낮은 채도의 색으로 표시
 * 좌측 Y축 + 하단 시간 라벨(00~23)
 *
 * @param {number[]} up   - 상행 0~23시 교통량 배열 (대/시)
 * @param {number[]} down - 하행 0~23시 교통량 배열 (대/시)
 * @param {string}   name - 교차로 이름
 */
function ForecastChart({ up = [], down = [], name }) {
  const [selectedHour, setSelectedHour] = useState(null);
  const all = [...up, ...down];
  const maxVal = all.length ? Math.max(...all, 1) : 1;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const peakUp = up.length ? up.indexOf(Math.max(...up)) : -1;   // 상행 피크 시간
  const peakDn = down.length ? down.indexOf(Math.max(...down)) : -1; // 하행 피크 시간
  const activeUpHour = selectedHour ?? peakUp;
  const activeDnHour = selectedHour ?? peakDn;
  const selectedUpValue = selectedHour != null ? (up[selectedHour] ?? 0) : null;
  const selectedDnValue = selectedHour != null ? (down[selectedHour] ?? 0) : null;
  const axisVals = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      {/* 헤더: 교차로명 + 피크 정보 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: "12px 14px" }}>
        <div>
          <div style={{ fontSize: 15, color: "#fff", fontWeight: 700 }}>
            <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>▪</span>{name || "—"}
          </div>
          <div style={{ fontSize: 9, color: V.ink2, fontFamily: V.mono, marginTop: 3 }}>상행/하행 0시–23시 예측 (대/시)</div>
        </div>
        {/* 상행/하행 피크 요약 */}
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: selectedHour != null ? "선택 상행" : "상행 피크", sw: V.blu, val: selectedHour != null ? selectedUpValue : (up.length ? Math.max(...up) : "—"), h: selectedHour != null ? `${selectedHour}시` : (peakUp >= 0 ? `${peakUp}시` : "") },
            { label: selectedHour != null ? "선택 하행" : "하행 피크", sw: "#ff8e55", val: selectedHour != null ? selectedDnValue : (down.length ? Math.max(...down) : "—"), h: selectedHour != null ? `${selectedHour}시` : (peakDn >= 0 ? `${peakDn}시` : "") }
          ].map(s => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: V.ink1 }}>
              <span style={{ width: 14, height: 3, borderRadius: 1, background: s.sw, display: "inline-block" }} />
              <span style={{ fontSize: 11, color: V.ink2 }}>{s.label}</span>
              <b style={{ fontFamily: V.mono, color: "#fff", fontSize: 14, fontWeight: 700 }}>{s.val}</b>
              {s.h && <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2 }}>· {s.h}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 차트 본체 */}
      <div style={{ display: "flex", flex: 1, minHeight: 170 }}>
        {/* Y축 레이블 */}
        <div style={{ width: 44, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "6px 8px 28px 0", fontFamily: V.mono, fontSize: 11, color: V.ink2, borderRight: `1px dashed ${V.line}`, textAlign: "right" }}>
          {axisVals.map((v, i) => <span key={i}>{v}</span>)}
        </div>
        <div style={{ flex: 1, position: "relative", paddingTop: 6 }}>
          {/* 수평 그리드 라인 */}
          {[0, 25, 50, 75].map(p => (
            <div key={p} style={{ position: "absolute", left: 0, right: 0, height: 1, background: "#141414", top: `${p}%`, pointerEvents: "none" }} />
          ))}
          <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: V.line, bottom: 28 }} />
          {/* 막대 그리드: 24시간 × 상행/하행 2개 막대 */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 6, bottom: 28, display: "grid", gridTemplateColumns: "repeat(24,1fr)", alignItems: "flex-end" }}>
            {hours.map(h => {
              const u = up[h] ?? 0, d = down[h] ?? 0;
              const uH = (u / maxVal) * 100, dH = (d / maxVal) * 100;
              const isActiveUp = h === activeUpHour;
              const isActiveDn = h === activeDnHour;
              const isSelected = selectedHour === h;
              // 선택/피크 시간대만 선명하게 강조하고, 나머지 막대는 흐리지만 식별 가능하게 표시
              const upColor = isActiveUp ? V.blu : "rgba(78,166,255,0.58)";
              const downColor = isActiveDn ? "#ff8e55" : "rgba(255,142,85,0.56)";
              return (
                <div
                  key={h}
                  onClick={() => setSelectedHour(prev => prev === h ? null : h)}
                  title={`${String(h).padStart(2, "0")}시 · 상행 ${u.toLocaleString()}대 / 하행 ${d.toLocaleString()}대`}
                  style={{
                    display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 1,
                    height: "100%", padding: "0 1px", cursor: "pointer", position: "relative",
                    background: isSelected ? "rgba(255,255,255,0.055)" : "transparent",
                    borderRadius: 2,
                  }}
                >
                  {/* 상행 막대: 선택한 시간 또는 피크 시간만 선명하게 강조 */}
                  <div style={{
                    width: isActiveUp ? 8 : 6, height: `${uH}%`, minHeight: uH > 0 ? 2 : 0,
                    background: upColor, borderRadius: "1px 1px 0 0",
                    outline: isActiveUp ? "1px solid #fff" : "none",
                    boxShadow: isActiveUp ? `0 0 12px ${V.blu}99` : "none",
                    opacity: isActiveUp ? 1 : 0.84,
                    transition: "opacity .15s ease, box-shadow .15s ease, background .15s ease, width .15s ease",
                  }} />
                  {/* 하행 막대: 선택한 시간 또는 피크 시간만 선명하게 강조 */}
                  <div style={{
                    width: isActiveDn ? 8 : 6, height: `${dH}%`, minHeight: dH > 0 ? 2 : 0,
                    background: downColor, borderRadius: "1px 1px 0 0",
                    outline: isActiveDn ? "1px solid #fff" : "none",
                    boxShadow: isActiveDn ? "0 0 12px rgba(255,142,85,0.75)" : "none",
                    opacity: isActiveDn ? 1 : 0.84,
                    transition: "opacity .15s ease, box-shadow .15s ease, background .15s ease, width .15s ease",
                  }} />
                </div>
              );
            })}
          </div>
          {/* X축 시간 레이블 (00~23) */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, display: "grid", gridTemplateColumns: "repeat(24,1fr)", fontFamily: V.mono, fontSize: 10, color: V.ink2, textAlign: "center" }}>
            {hours.map(h => {
              const isActive = h === activeUpHour || h === activeDnHour;
              const isSelected = selectedHour === h;
              return (
                <span
                  key={h}
                  onClick={() => setSelectedHour(prev => prev === h ? null : h)}
                  style={{
                    paddingTop: 4, color: isActive ? "#fff" : V.ink2, fontWeight: isActive ? 700 : 400,
                    cursor: "pointer", borderTop: isSelected ? `1px solid ${V.blu}` : "1px solid transparent",
                    background: isSelected ? "rgba(78,166,255,0.08)" : "transparent",
                  }}
                >
                  {String(h).padStart(2, "0")}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StationPredictDropdown({ stations, selectedId, onSelect }) {
  return (
    <select 
      value={selectedId} 
      onChange={(e) => onSelect(e.target.value)}
      style={{ 
        background: "#0a1020", 
        border: `1px solid ${V.line}`, 
        borderRadius: 4, 
        color: "#fff",
        fontSize: 13, 
        padding: "6px 12px", 
        fontFamily: V.sans,
        outline: "none",
        cursor: "pointer",
        minWidth: "220px"
      }}
    >
      {stations.map((st) => (
        <option key={st.stationId} value={st.stationId}>
          {st.stationName}
        </option>
      ))}
    </select>
  );
}

// ── SpeedDropdown ─────────────────────────────────────────────────────────────
/**
 * 속도 모니터링 교차로 선택 드롭다운
 * 최대 3개 교차로를 토글 선택, 검색 기능 포함
 * 3개 초과 선택 시 가장 오래된 항목 자동 제거 (FIFO)
 *
 * @param {Array}    options    - 전체 교차로 목록 [{ id, name, speed }]
 * @param {Array}    selected   - 현재 선택된 교차로 목록
 * @param {Function} onToggle   - 교차로 토글 콜백 (opt 전달)
 */
function SpeedDropdown({ options, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();
  const inputRef = useRef();

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = options.filter(o => o.name.includes(query));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* 토글 버튼: 선택된 교차로명 표시 */}
      <button onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 50); }} style={{
        background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, color: "#fff",
        fontFamily: V.sans, fontSize: 13, fontWeight: 600, padding: "7px 30px 7px 14px",
        cursor: "pointer", minWidth: 220, textAlign: "left", position: "relative",
      }}>
        {selected.length > 0 ? selected.map(s => s.name).join(", ") : "교차로 선택 (최대 3개)"}
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: V.ink2 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 200, background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 2, minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,.8)" }}>
          {/* 검색 입력 */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${V.line}` }}>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="교차로 검색..."
              style={{ width: "100%", background: "#141414", border: `1px solid ${V.line}`, borderRadius: 2, color: "#fff", fontSize: 13, padding: "6px 10px", fontFamily: V.sans, outline: "none" }} />
          </div>
          {/* 교차로 목록 */}
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0
              ? <div style={{ padding: "14px", fontSize: 13, color: V.ink2, textAlign: "center" }}>검색 결과 없음</div>
              : filtered.map((opt, i) => {
                  const isSel = selected.some(s => s.id === opt.id);
                  return (
                    <div key={opt.id} onClick={() => onToggle(opt)}
                      style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        background: isSel ? "#141414" : "transparent", borderBottom: `1px solid ${V.line}`,
                        color: isSel ? "#fff" : V.ink1, fontSize: 13, fontWeight: isSel ? 600 : 400 }}>
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

// ── RiskDropdown ──────────────────────────────────────────────────────────────
/**
 * 관심 교차로 검색/등록 드롭다운
 * selectedIdx === -1 이면 "등록 모드" (+ / ✓ 토글 표시)
 * selectedIdx >= 0 이면 "선택 모드" (클릭 시 바로 닫힘)
 *
 * @param {Array}    options     - 교차로 목록 [{ id, name, score, speed, congestion }]
 * @param {number}   selectedIdx - 현재 선택 인덱스 (-1이면 등록 모드)
 * @param {Function} onChange    - 인덱스 변경 콜백
 * @param {string[]} watchIds    - 현재 관심 등록된 교차로 ID 배열
 */
function RiskDropdown({ options, selectedIdx, onChange, watchIds = [] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();
  const inputRef = useRef();

  // 외부 클릭 시 닫기
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const levelLabel = riskLevel;
  const isRegisterMode = watchIds.length > 0 || selectedIdx === -1;
  const filtered = options.map((o, i) => ({ ...o, origIdx: i })).filter(o => o.name.includes(query));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 50); }} style={{
        background: "#0a1020", border: `1px solid ${V.line}`, borderRadius: 999, color: "#fff",
        fontFamily: V.sans, fontSize: 13, fontWeight: 600, padding: "8px 32px 8px 14px",
        cursor: "pointer", minWidth: 220, textAlign: "left", position: "relative",
      }}>
        {isRegisterMode ? "교차로 검색 후 등록" : options[selectedIdx] ? `${options[selectedIdx].name}` : "교차로 선택"}
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: V.ink2 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 200, background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 2, minWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,.8)" }}>
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${V.line}` }}>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="교차로 검색..."
              style={{ width: "100%", background: "#141414", border: `1px solid ${V.line}`, borderRadius: 2, color: "#fff", fontSize: 13, padding: "6px 10px", fontFamily: V.sans, outline: "none" }} />
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
                        background: isSel || isWatched ? "#141414" : "transparent", borderBottom: `1px solid ${V.line}`,
                        color: isSel || isWatched ? "#fff" : V.ink1, fontSize: 13 }}>
                      <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, minWidth: 28 }}>#{opt.origIdx + 1}</span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{opt.name}</span>
                      <span style={{ fontFamily: V.mono, fontSize: 13, color, fontWeight: 700 }}>{hasRiskScore(opt.score) ? `${opt.score}점` : "—"}</span>
                      <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, minWidth: 36 }}>({levelLabel(opt.score, opt.grade)})</span>
                      {/* 등록 모드: + 또는 ✓ 표시 */}
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

// ── 상수 ─────────────────────────────────────────────────────────────────────
// 속도 카드 3개에 순서대로 할당되는 색상 (빨강 → 주황 → 초록)
const CARD_COLORS = [V.red, V.org, V.grn];

// ── MainDashboard (메인 컴포넌트) ─────────────────────────────────────────────
/**
 * 통합 대시보드 페이지
 *
 * Props:
 *   onGoMap   - 지도 페이지 이동 콜백 (구 좌표 전달)
 *   onGoCctv  - CCTV 관제 페이지 이동 콜백
 *   wsData    - App에서 관리하는 WebSocket 교차로 신호 데이터 배열
 */

export default function MainDashboard({
  onGoMap,
  onGoCctv,
  onGoNews,
  onGoSimulation,
  onGoComplaints,
  onGoMyPage,
  onLogout,
  wsData,
  stations = [],
  setStations,
  selectedGu,
  onSelectGu,
  onAreaFetchState,
  onRegisterSelectGu,
  isMuted = false,
  onToggleMute,
  isMicActive = false,
  onToggleMic,
  notifQueue = [],
  onDismissNotif,
}) {
  const [time, setTime] = useState(new Date());
  const [loading, setLoading] = useState(false);
  // "송파구 · 12개 교차로 수집됨" 같은 임시 메시지 (3초 후 사라짐)
  const [fetchMsg, setFetchMsg] = useState(null);

  // 속도 카드: 드롭다운에서 선택한 교차로 최대 3개
  const [speedSelected, setSpeedSelected] = useState([]);
  // 교차로ID → 속도 히스토리 배열 (ref: setState 없이 직접 push/shift)
  const sparkRef = useRef({});
  const sparkVersionRef = useRef(null);
  if (sparkVersionRef.current !== SPARK_RUNTIME_VERSION) {
    sparkRef.current = {};
    sparkVersionRef.current = SPARK_RUNTIME_VERSION;
    try {
      window.localStorage.removeItem(OLD_SPARK_HISTORY_KEY);
    } catch {
      // localStorage를 쓸 수 없어도 현재 세션 그래프는 정상 동작한다.
    }
  }

  // 관심 교차로 목록 (최대 8개, 수동 등록)
  const [watchList, setWatchList] = useState([]);
  // 위험도 패널에서 현재 선택된 슬롯 인덱스
  const [riskIdx, setRiskIdx] = useState(0);

  
  // 1. 지점 목록과 선택된 ID 관리
  // const [stations, setStations] = useState([]); 
  const [predictStationId, setPredictStationId] = useState(""); 
  // 예측 차트 데이터 { up, down, name, isDummy }
  const [forecast, setForecast] = useState({ up: [], down: [], name: "—" });

  // 헤더 시계: 1초마다 갱신
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 로그인 직후 (wsData가 비어있을 때) 강남구 자동 fetch — 한 번만 실행
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (!autoFetchedRef.current && wsData.length === 0 && selectedGu) {
      autoFetchedRef.current = true;
      handleSelectGu(selectedGu);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sparkline 히스토리 최대 보관 개수. 5초 샘플링 기준 60분치다.
  const LIV_MAX = SPARK_MAX_SAMPLES;

  const appendSparkSample = useCallback((id, speed) => {
    const key = String(id ?? "");
    const value = Number(speed);
    if (!key || !Number.isFinite(value)) return false;

    const arr = sparkRef.current[key] ?? [];
    arr.push(value);
    if (arr.length > LIV_MAX) {
      arr.splice(0, arr.length - LIV_MAX);
    }
    sparkRef.current[key] = arr;
    return true;
  }, [LIV_MAX]);

  const flushSparkHistory = useCallback(() => {
    setTime(new Date()); // 강제 리렌더 (sparkRef는 ref라 자동 리렌더 안 됨)
  }, []);

  /**
   * handleSelectGu — 서울 SVG 지도에서 구 클릭 시 호출
   * 1. selectedGu 업데이트 (SVG에서 선택 링 표시)
   * 2. POST /api/fetch-area → 스프링이 해당 구 V2X 데이터 수집
   * 3. 스프링 → WebSocket 브로드캐스트 → wsData 업데이트 (자동)
   * 4. fetchMsg 3초 표시 후 사라짐
   */
  const handleSelectGu = useCallback(async (gu) => {
    setLoading(true);
    setFetchMsg(null);
    onAreaFetchState?.({ status: "loading", guName: gu.name, count: 0 });
    try {
      const params = new URLSearchParams({
        guName: gu.name,
        lat: String(gu.lat),
        lon: String(gu.lon),
        radius: "2.5",
      });
      const res = await fetch(`${API_BASE}/api/fetch-area?${params.toString()}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        onAreaFetchState?.({ status: "error", guName: gu.name, count: 0 });
        // 503: V2X API 타임아웃 — 캐시는 유지됨, 잠시 후 재시도 안내
        setFetchMsg(`⚠ ${data.message ?? `${gu.name} 수집 실패`}`);
        return;
      }
      onSelectGu(gu);       // App level 상태 업데이트 (페이지 이동 후에도 유지됨)
      onAreaFetchState?.({ status: "done", guName: gu.name, count: data.count ?? 0 });
      setRiskIdx(0);
      setWatchList([]);
      setSpeedSelected([]);
      setFetchMsg(`${gu.name} · ${data.count ?? 0}개 교차로 수집됨`);
    } catch {
      onAreaFetchState?.({ status: "error", guName: gu.name, count: 0 });
      setFetchMsg(`${gu.name} 데이터 수집 실패`);
    } finally {
      setLoading(false);
      setTimeout(() => setFetchMsg(null), 3000);
    }
  }, [onSelectGu, onAreaFetchState]);

  // 음성 명령 select_gu 핸들러를 App의 ref에 등록
  useEffect(() => {
    onRegisterSelectGu?.(handleSelectGu);
  }, [onRegisterSelectGu, handleSelectGu]);

  // ── 활성 데이터 계산 ────────────────────────────────────────────────────────
  // 선택된 구 반경 2.5km 내 교차로만 필터한다. 결과가 없을 때 이전 구역 전체 데이터로 대체하면 화면이 섞여 보인다.
  const activeData = useMemo(() => (
    selectedGu
      ? wsData.filter(c => c.lat && c.lon && calcDistKm(c.lat, c.lon, selectedGu.lat, selectedGu.lon) <= 2.5)
      : wsData
  ), [selectedGu, wsData]);
  const isLive = wsData.length > 0; // WebSocket 연결 여부


  // ── 교통량 지점 구별 필터링 ────────────────────────────────────────────────
  const filteredStations = useMemo(() => {
    // stations가 없을 경우(undefined)를 대비해 stations?.length 로 체크하거나
    // stations || [] 처럼 기본값을 줍니다.
    if (!selectedGu || !stations || stations.length === 0) {
      return stations || []; 
    }

    return stations.filter(st => {
      const lat = st.latitude || st.lat;
      const lng = st.longitude || st.lng;
      if (!lat || !lng) return false;

      const dist = calcDistKm(lat, lng, selectedGu.lat, selectedGu.lon);
      return dist <= 2.5;
    });
  }, [stations, selectedGu]); // stations가 바뀌면 다시 계산

  // 구가 바뀌면 해당 구의 첫 번째 지점을 자동으로 선택해주기
  useEffect(() => {
    if (filteredStations.length > 0) {
      setPredictStationId(filteredStations[0].stationId);
    }
  }, [filteredStations]);


  // ── KPI 계산 ────────────────────────────────────────────────────────────────
  const validSpeeds = activeData.map(c => c.speed).filter(Number.isFinite);
  const avgSpeed  = validSpeeds.length ? Math.round(validSpeeds.reduce((a, v) => a + v, 0) / validSpeeds.length) : "—";
  const riskReadyData = activeData.filter(c => hasRiskScore(c.riskScore) || hasRiskGrade(c.riskGrade));
  const highRisk  = riskReadyData.filter(c => (riskGradeValue(c.riskGrade) ?? 0) >= 3).length;
  const sortedByRisk = [...activeData].sort((a, b) => riskRank(b) - riskRank(a));
  const maxRiskItem  = [...riskReadyData].sort((a, b) => riskRank(b) - riskRank(a))[0];
  const maxRisk      = maxRiskItem?.riskScore ?? "—";
  const guLabel      = selectedGu ? `${selectedGu.name} 반경 2.5km` : "전체";
  const speedStatus  = typeof avgSpeed === "number" ? statusOf(avgSpeed) : "대기";
  const maxRiskGrade = riskReadyData.reduce((max, c) => Math.max(max, riskGradeValue(c.riskGrade) ?? 0), 0);
  const riskStatus   = riskReadyData.length === 0 ? "대기" : maxRiskGrade >= 4 ? "심각" : maxRiskGrade >= 3 ? "위험" : maxRiskGrade >= 2 ? "주의" : "정상";

  // ── 위험도 리스트 (드롭다운 검색 + 그리드 슬롯용) ───────────────────────────
  const riskData = sortedByRisk.map(c => ({
    name: c.crsrdNm, score: hasRiskScore(c.riskScore) ? c.riskScore : null,
    grade: c.riskGrade,
    speed: c.speed, congestion: c.congestion ?? "—",
    id: c.crsrdId,
  }));

  // watchList 항목에 실시간 점수 반영
  const watchListLive = watchList.map(w => {
    const live = riskData.find(r => r.id === w.id);
    return live ?? w; // 실시간 데이터 없으면 저장값 사용
  });

  // 8개 슬롯이 채워지지 않으면 위험도 상위 순으로 자동 채움
  const autoFill = riskData.filter(r => !watchListLive.some(w => w.id === r.id)).slice(0, 8 - watchListLive.length);
  const displayWatch = [...watchListLive, ...autoFill].slice(0, 8);
  const selectedRisk = displayWatch[riskIdx] ?? displayWatch[0];

  /**
   * toggleWatch — 관심 교차로 등록/해제 토글
   * 최대 8개 제한, 이미 있으면 제거, 없으면 추가
   */
  const toggleWatch = (item) => {
    setWatchList(prev => {
      const exists = prev.some(w => w.id === item.id);
      if (exists) return prev.filter(w => w.id !== item.id);
      if (prev.length >= 8) return prev;
      return [...prev, item];
    });
    setRiskIdx(0);
  };

  // ── 속도 카드 데이터 ─────────────────────────────────────────────────────────
  const speedOptions = activeData.map(c => ({ id: c.crsrdId, name: c.crsrdNm, speed: c.speed }));
  const speedCardSource = activeData.filter(c => Number.isFinite(c.speed));

  // 드롭다운 선택 있으면 그것, 없으면 속도 하위 3개 자동 선택, wsData 없으면 더미
  const displayCards = speedSelected.length > 0
    ? speedSelected.map((s, i) => {
        const live = activeData.find(c => c.crsrdId === s.id);
        const spd = live?.speed ?? s.speed;
        return { id: s.id, name: s.name, color: CARD_COLORS[i % 3], speed: spd, sparkData: sparkRef.current[s.id] ?? makeSpark(spd) };
      })
    : speedCardSource.length > 0
    ? [...speedCardSource].sort((a, b) => a.speed - b.speed).slice(0, 3).map((c, i) => ({
        id: c.crsrdId,
        name: c.crsrdNm, color: CARD_COLORS[i],
        speed: c.speed,
        sparkData: sparkRef.current[c.crsrdId] ?? makeSpark(c.speed),
      }))
    : activeData.length > 0
    ? activeData.slice(0, 3).map((c, i) => ({
        id: c.crsrdId,
        name: c.crsrdNm, color: CARD_COLORS[i],
        speed: null,
        sparkData: [],
      }))
    // wsData 없을 때는 카드 틀만 유지하고 숫자 더미는 만들지 않는다.
    : [
        { name: "수집 대기", color: V.red, speed: null, sparkData: [] },
        { name: "수집 대기", color: V.org, speed: null, sparkData: [] },
        { name: "수집 대기", color: V.grn, speed: null, sparkData: [] },
      ];
  const sparkSampleCount = displayCards.reduce((max, c) => Math.max(max, c.sparkData?.length ?? 0), 0);
  const sparkMinutes = Math.min(60, Math.floor((sparkSampleCount * SPARK_SAMPLE_INTERVAL_MS) / 60000));
  const visibleCardSampleKey = displayCards.map(c => `${c.id ?? ""}:${c.speed ?? ""}`).join("|");

  useEffect(() => {
    let changed = false;
    displayCards.forEach(c => {
      const key = String(c.id ?? "");
      const speed = Number(c.speed);
      if (!key || !Number.isFinite(speed)) return;

      const arr = sparkRef.current[key];
      if (!arr || arr.length === 0) {
        sparkRef.current[key] = [speed];
        changed = true;
        return;
      }

      if (arr[arr.length - 1] !== speed) {
        changed = appendSparkSample(key, speed) || changed;
      }
    });
    if (changed) {
      flushSparkHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendSparkSample, visibleCardSampleKey, flushSparkHistory]);

  useEffect(() => {
    const sampleTargets = displayCards
      .map(c => ({ id: c.id, speed: Number(c.speed) }))
      .filter(c => c.id && Number.isFinite(c.speed));
    if (sampleTargets.length === 0) return;

    const timer = setInterval(() => {
      let changed = false;
      sampleTargets.forEach(c => {
        changed = appendSparkSample(c.id, c.speed) || changed;
      });
      if (changed) {
        flushSparkHistory();
      }
    }, SPARK_SAMPLE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [appendSparkSample, flushSparkHistory, visibleCardSampleKey]);

  /**
   * toggleSpeedCard — 속도 카드 드롭다운 토글
   * 최대 3개, 초과 시 가장 오래된 항목(앞) 제거
   */
  const toggleSpeedCard = (opt) => {
    setSpeedSelected(prev => {
      const exists = prev.some(s => s.id === opt.id);
      if (exists) return prev.filter(s => s.id !== opt.id);
      if (prev.length >= 3) return [...prev.slice(1), opt]; // FIFO
      return [...prev, opt];
    });
  };

  // ── 교통량 예측 데이터 로드 ────────────────────────────────────────────────────────
  

  // 2. 페이지 시작 시 DB에서 목록 가져오기
  useEffect(() => {
    fetch(`${API_BASE}/api/stations`)
      .then(res => res.json())
      .then(data => {
        setStations(data);
        if (data.length > 0) {
          setPredictStationId(data[0].stationId); // 첫 번째 지점 자동 선택
        }
      })
      .catch(err => console.error("지점 목록 로드 실패:", err));
  }, []);

  // 3. 지점 선택 시 실제 예측 데이터 가져오기 (이 부분이 핵심!)
  useEffect(() => {
    // 선택된 지점이 없으면 아무것도 안 함
    if (!predictStationId) return;

    // (옵션) 더미 안 보여주기로 했으니 로딩 중임을 표시하기 위해 상태 초기화
    setForecast(prev => ({ ...prev, isLoaded: false }));

    // 자바 서버를 통해 파이썬 모델 결과 요청
    fetch(`${API_BASE}/api/forecast/station/${predictStationId}`)
      .then((r) => {
        if (!r.ok) throw new Error("서버 응답 에러");
        return r.json();
      })
      .then((d) => {
        if (d.up && d.down) {
          // ★ 진짜 AI 데이터로 차트 업데이트!
          setForecast({
            up: d.up,
            down: d.down,
            name: d.stationNm || "예측 지점", 
            isLoaded: true, // 로딩 완료
            isDummy: false
          });
        }
      })
      .catch((err) => {
        console.error("예측 데이터 로드 실패:", err);
        // 실패 시 차트를 비워둡니다
        setForecast(prev => ({ ...prev, isLoaded: false }));
      });
  }, [predictStationId]); // ★ 이제 selectedRisk가 아니라 predictStationId가 바뀔 때 실행됨!



  // ── 위험도 breakdown 아이템 ──────────────────────────────────────────────────
  // 선택된 교차로의 위험도·속도·혼잡도를 수평 프로그레스 바로 표시
  const bdItems = selectedRisk ? [
    { label: "도로 위험도", sub: `교차로 구조 · 사고 이력 종합 · ${RISK_MAX_SCORE}점 기준`, value: hasRiskScore(selectedRisk.score) ? selectedRisk.score : "—", unit: "점", color: riskColor(selectedRisk.score, selectedRisk.grade), pct: riskPercent(selectedRisk.score) },
    { label: "실시간 평균 속도", sub: "TOPIS 수집 · 낮을수록 위험", value: selectedRisk.speed ?? "—", unit: "km/h", color: V.org, pct: selectedRisk.speed == null ? 0 : Math.min((selectedRisk.speed / 80) * 100, 100) },
    { label: "혼잡 상태", sub: "현재 구간 추정", value: selectedRisk.congestion, unit: "", color: V.blu, pct: 50 },
  ] : [];

  // ── 렌더링 ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: V.sans, background: V.bg0, color: V.ink0, minHeight: "100vh", display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "hidden" }}>

      <ReActToastContainer />

      {/* ── 헤더 (sticky) ── */}
      <AppHeader
        activePage="main"
        selectedGu={selectedGu}
        fetchMsg={fetchMsg}
        // statusText={isLive ? "LIVE · V2X 연결됨" : undefined}
        statusText={isLive ? undefined : undefined}
        statusLive={isLive}
        onGoMain={() => {}}
        onGoMap={onGoMap}
        onGoNews={onGoNews}
        onGoCctv={onGoCctv}
        onGoSimulation={onGoSimulation}
        onGoComplaints={onGoComplaints}
        onGoMyPage={onGoMyPage}
        onLogout={onLogout}
        notifQueue={notifQueue}
        onDismissNotif={onDismissNotif}
        rightExtra={(
          <>
            {onToggleMute && (
              <button
                onClick={onToggleMute}
                title={isMuted ? "음소거 해제" : "음소거"}
                style={{
                  background: isMuted ? "#1a0a0a" : "transparent",
                  // border: `1px solid ${isMuted ? "#5a1a1a" : V.line}`,
                  border: 0,
                  borderRadius: 999,
                  width: 32, height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  color: isMuted ? "#ff5566" : V.ink1,
                  fontSize: 15,
                  flexShrink: 0,
                  transition: "border-color .2s, color .2s",
                }}
              >
                {/* {isMuted ? "🔇" : "🔊"} */}
                <img
                  src={isMuted ? "/icons/mute.png" : "/icons/speaker.png"}
                  alt=""
                  style={{width: 18, height: 18, objectFit: "contain", filter: "invert(1)", opacity: isMuted ? 1 : 0.9,}}
                />
              </button>
            )}
            {selectedGu && (
              <BottleneckEmailBtn district={selectedGu.name} apiBase={API_BASE} />
            )}
          </>
        )}
      />

      {/* ── KPI 카드 4개 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, padding: "10px 14px" }}>
      {/* <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, padding: "6px 10px" }}> */}
        <KpiCard value={activeData.length || 0} unit="개" label="모니터링 교차로" sub={guLabel} status="정상" />
        <KpiCard value={riskReadyData.length ? highRisk : "—"} unit={riskReadyData.length ? "개" : ""} label="위험 교차로" sub={riskReadyData.length ? "등급 3 이상" : "위험도 수집 대기"} status={riskStatus} />
        <KpiCard value={avgSpeed} unit="km/h" label="현재 평균 속도" sub="전 교차로 추정" status={speedStatus} />
        <KpiCard value={maxRisk} unit={hasRiskScore(maxRisk) ? "점" : ""} label="최고 위험도" sub={maxRiskItem?.crsrdNm ?? "위험도 수집 대기"} status={maxRiskItem ? riskLevel(maxRiskItem.riskScore, maxRiskItem.riskGrade) : "대기"} />
      </div>

      {/* ── 2행: 실시간 속도 + 서울 지도 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, padding: "0 14px", alignItems: "stretch" }}>
      {/* <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 6, padding: "0 10px", alignItems: "stretch" }}> */}

        {/* 실시간 구간 속도 패널 */}
        <div style={{ ...panelStyle, display: "flex", flexDirection: "column" }}>
        {/* <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, display: "flex", flexDirection: "column" }}> */}
          <div style={{ ...panelHeaderStyle, flexWrap: "wrap" }}>
          {/* <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: `1px solid ${V.line}`, background: "#080808", flexWrap: "wrap", flexShrink: 0 }}> */}
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>
            {/* <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}> */}
              <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>▪</span>실시간 구간 속도
            </span>
            {/* 교차로 선택 드롭다운 */}
            <SpeedDropdown options={speedOptions} selected={speedSelected} onToggle={toggleSpeedCard} />
            <div style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 12, color: isLive ? V.grn : V.ink2, padding: "3px 8px", border: `1px solid ${isLive ? "#1a3a24" : V.line}`, borderRadius: 2, background: isLive ? "#0c1a12" : V.bg0 }}>
              {isLive ? "● LIVE · 수집 중" : "대기 중"}
            </div>
          </div>
          <div style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column" }}>
            {/* LivCard 3개 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, flex: 1 }}>
              {displayCards.map((c, i) => <LivCard key={c.id ?? i} {...c} />)}
            </div>
            {/* 하단 상태 바 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "7px 10px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, fontFamily: V.mono, fontSize: 12, color: V.ink2, flexShrink: 0 }}>
              <span>마지막 갱신 {isLive ? time.toLocaleTimeString("ko-KR") : "—"}</span>
              <span style={{ color: V.ink3 }}>·</span>
              <span>누적 {sparkMinutes}분 / 최대 60분</span>
              <span style={{ marginLeft: "auto", color: "#5a6378" }}>5초 간격 샘플링 · 현재 화면 기준</span>
            </div>
          </div>
        </div>

        {/* 서울 SVG 지도 */}
        <div style={{ ...panelStyle, display: "flex", flexDirection: "column", minHeight: 360 }}>
        {/* <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, display: "flex", flexDirection: "column", minHeight: 360 }}> */}
          <div style={panelHeaderStyle}>
          {/* <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: `1px solid ${V.line}`, background: "#080808", flexShrink: 0 }}> */}
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
              <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>▪</span>서울 교통 현황
            </span>
            <button onClick={() => onGoMap(selectedGu)} style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 11, fontWeight: 700, color: V.ink1, padding: "3px 8px", border: `1px solid ${V.line}`, borderRadius: 2, background: V.bg0, cursor: "pointer" }}>
              실시간 지도 →
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <SeoulSvgMap onGoMap={onGoMap} selectedGu={selectedGu} onSelectGu={handleSelectGu} loading={loading} />
          </div>
        </div>

      </div>

      
      {/* ── 3행: 위험도 패널 + 예측 차트 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, padding: "10px 14px 18px", alignItems: "stretch" }}>
      {/* <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 6, padding: "6px 10px 16px", alignItems: "stretch" }}> */}

        {/* 위험도 패널 */}
        <div style={{ ...panelStyle }}>
        {/* <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2 }}> */}
          <div style={panelHeaderStyle}>
          {/* <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: `1px solid ${V.line}`, background: "#080808" }}> */}
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
              <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>▪</span>교차로별 위험도
            </span>
            <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 12, color: isLive ? V.grn : V.ink2, padding: "3px 8px", border: `1px solid ${isLive ? "#1a3a24" : V.line}`, borderRadius: 2, background: isLive ? "#0c1a12" : V.bg0 }}>
              {isLive ? "● 실시간" : "참고값"}
            </span>
          </div>
          <div style={{ padding: 12 }}>
            {/* 관심 교차로 등록 바 */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 12px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>◉</span>관심 교차로 등록
              </span>
              {/* 등록 모드 드롭다운 (selectedIdx=-1) */}
              <RiskDropdown options={riskData} selectedIdx={-1} onChange={i => toggleWatch(riskData[i])} watchIds={watchList.map(w => w.id)} />
              <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 11, color: V.ink2 }}>{watchList.length}/8 등록됨 · 최대 8개</span>
            </div>

            {/* 8슬롯 그리드 (클릭 → 도넛/예측 차트 연동) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", border: `1px solid ${V.line}`, borderRadius: 2, background: V.bg1, marginBottom: 10, overflow: "hidden" }}>
              {Array.from({ length: 8 }).map((_, i) => {
                const d = displayWatch[i];
                const isManual = d && watchList.some(w => w.id === d.id);
                const color = d ? riskColor(d.score, d.grade) : V.line;
                const isSel = i === riskIdx;
                return d ? (
                  <div key={i} onClick={() => setRiskIdx(i)} style={{
                    display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 10,
                    padding: "10px 12px", background: isSel ? "#141414" : "transparent",
                    borderRight: `1px solid ${V.line}`, borderBottom: `1px solid ${V.line}`,
                    cursor: "pointer",
                    boxShadow: isSel ? `inset 2px 0 0 ${color}` : "none", // 선택 강조: 좌측 색상 막대
                  }}>
                    <span style={{ fontFamily: V.mono, fontSize: 12, color: isSel ? "#fff" : V.ink2, fontWeight: 700 }}>#{i + 1}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#d8dde8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span style={{ fontFamily: V.mono, fontSize: 16, fontWeight: 700, color: "#fff" }}>{hasRiskScore(d.score) ? d.score : "—"}</span>
                      {/* 수동 등록 항목만 ✕ 제거 버튼 표시 */}
                      {isManual && (
                        <span onClick={e => { e.stopPropagation(); toggleWatch(d); }}
                          style={{ fontSize: 9, color: V.ink2, cursor: "pointer", padding: "1px 4px", border: `1px solid ${V.line}`, borderRadius: 2 }}>✕</span>
                      )}
                    </div>
                  </div>
                ) : (
                  // 빈 슬롯
                  <div key={i} style={{ padding: "10px 12px", borderRight: `1px solid ${V.line}`, borderBottom: `1px solid ${V.line}`, display: "flex", alignItems: "center", justifyContent: "center", border: `1px dashed ${V.line}`, color: V.ink3, fontSize: 11, fontFamily: V.mono }}>
                    #{i + 1} 빈 슬롯
                  </div>
                );
              })}
            </div>

            {/* 도넛 차트 + 위험도 breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <DonutChart name={selectedRisk?.name} score={selectedRisk?.score} grade={selectedRisk?.grade} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {bdItems.map((b, i) => (
                  <div key={i} style={{ background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr auto", rowGap: 12 }}>
                    <div style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>
                      {b.label}
                      <small style={{ display: "block", color: V.ink2, fontSize: 11, fontFamily: V.mono, fontWeight: 500, marginTop: 3 }}>{b.sub}</small>
                    </div>
                    <div style={{ fontFamily: V.mono, fontWeight: 700, fontSize: 22, color: "#fff", textAlign: "right", alignSelf: "end" }}>
                      {b.value}<em style={{ fontStyle: "normal", fontSize: 13, color: V.ink2, marginLeft: 3 }}>{b.unit}</em>
                    </div>
                    {/* 수평 프로그레스 바 */}
                    <div style={{ gridColumn: "1/3", height: 7, background: "#141414", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${b.pct}%`, background: b.color, borderRadius: 999, transition: "width .25s ease" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 시간대별 교통량 예측 */}
        <div style={{ ...panelStyle, display: "flex", flexDirection: "column" }}>
        {/* <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, display: "flex", flexDirection: "column" }}> */}
          <div style={panelHeaderStyle}>
          {/* <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: `1px solid ${V.line}`, background: "#080808" }}> */}
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
              <span style={{ color: V.ink3, marginRight: 8, fontSize: 11 }}>▪</span>시간대별 교통량 예측
            </span>
            <span style={{ 
              marginLeft: "auto", fontFamily: V.mono, fontSize: 11,
              color: forecast.isLoaded ? V.grn : V.org,
              padding: "3px 8px", border: `1px solid ${forecast.isLoaded ? "#1a3a24" : "#3a2a14"}`,
              borderRadius: 2, background: forecast.isLoaded ? "#0c1a12" : "#1a1206" 
            }}>
              {forecast.isLoaded ? "● 예측 모델" : "로드 중/데이터 없음"}
            </span>
          </div>

          {/* 관심 교차로 대신 DB 스테이션 드롭다운 사용 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: `1px solid ${V.line}`, background: "#060606" }}>
            <span style={{ fontSize: 12, color: V.ink2, fontFamily: V.mono }}>지점 선택</span>
            <StationPredictDropdown 
              stations={filteredStations} 
              selectedId={predictStationId} 
              onSelect={setPredictStationId} 
            />
          </div>

          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
            <ForecastChart up={forecast.up} down={forecast.down} name={forecast.name} />
          </div>
        </div>
      </div>

    </div>
  );
}
