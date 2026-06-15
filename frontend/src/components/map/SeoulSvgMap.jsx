import { useState, useEffect } from "react";
import { GU_LIST } from "../../constants/seoulGeoData";

const GU_COORDS = {
  "도봉구":   { cx:320, cy:40  }, "노원구":   { cx:290, cy:60  },
  "강북구":   { cx:250, cy:80  }, "은평구":   { cx:100, cy:80  },
  "성북구":   { cx:218, cy:106 }, "중랑구":   { cx:320, cy:100 },
  "종로구":   { cx:170, cy:124 }, "서대문구": { cx:130, cy:140 },
  "동대문구": { cx:282, cy:130 }, "마포구":   { cx:92,  cy:160 },
  "중구":   { cx:210, cy:150 }, "성동구":   { cx:262, cy:158 },
  "강서구":   { cx:56,  cy:220 }, "영등포구": { cx:140, cy:218 },
  "광진구":   { cx:320, cy:148 }, "강동구":   { cx:412, cy:230 },
  "양천구":   { cx:100, cy:226 }, "동작구":   { cx:190, cy:220 },
  "강남구":   { cx:260, cy:234 }, "구로구":   { cx:64,  cy:252 },
  "금천구": { cx:120, cy:270 }, "관악구":   { cx:180, cy:270 },
  "서초구":   { cx:250, cy:282 }, "송파구":   { cx:370, cy:240 },
  "용산구": { cx:190, cy:178 },
};


// 서울 전체 외곽선 (큰 틀 하나)
const SEOUL_OUTLINE = "64,52 158,52 204,52 220,20 292,20 350,20 390,42 424,76 446,154 446,226 400,240 388,270 344,278 248,294 168,284 108,274 66,276 40,272 16,220 16,196 62,108 64,52";

const HANGANG = "M0,170 C80,156 150,196 220,178 C300,156 360,196 460,176 L460,198 C360,220 300,178 220,200 C150,220 80,178 0,190 Z";

export default function SeoulSvgMap({ onGoMap, selectedGu, onSelectGu, loading, themeMode = "dark" }) {
  const [hoveredGu, setHoveredGu] = useState(null);
  const [pulse, setPulse] = useState(0);
  const isLight = themeMode === "light";
  const map = {
    bg: isLight ? "#f8fbff" : "#000",
    loadingBg: isLight ? "rgba(248,251,255,0.78)" : "rgba(0,0,0,0.7)",
    spinnerTrack: isLight ? "#c7d6ea" : "#333",
    fill0: isLight ? "#dbeafe" : "#1a3a6a",
    fill1: isLight ? "#eff6ff" : "#0a1a3a",
    fill0Opacity: isLight ? "0.9" : "0.35",
    fill1Opacity: isLight ? "0.72" : "0.10",
    outlineGlow: isLight ? "rgba(37,99,235,0.18)" : "rgba(78,166,255,0.25)",
    outline: isLight ? "rgba(37,99,235,0.62)" : "rgba(78,166,255,0.75)",
    river: isLight ? "#bfdbfe" : "#1a4f7a",
    riverHi: isLight ? "#60a5fa" : "#2a7fba",
    riverText: isLight ? "#2563eb" : "#9bd0ec",
    label: isLight ? "#334155" : "#aab4c8",
    labelHover: isLight ? "#0f172a" : "#e2e8f0",
    dotStroke: isLight ? "#ffffff" : "#fff",
  };

  useEffect(() => {
    const t = setInterval(() => setPulse(p => (p + 1) % 60), 60);
    return () => clearInterval(t);
  }, []);

  const guEntries = GU_LIST.map(gu => ({
    ...gu, coord: GU_COORDS[gu.name],
  })).filter(gu => gu.coord);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", userSelect: "none" }}>
      {loading && (
        <div style={{ position: "absolute", inset: 0, background: map.loadingBg, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ width: 16, height: 16, border: `2px solid ${map.spinnerTrack}`, borderTop: "2px solid #4ea6ff", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: 12, color: "#4ea6ff", fontFamily: "monospace" }}>수집 중...</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      <svg viewBox="0 0 460 320" preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          {/* 서울 내부 배경 그라데이션 */}
          <radialGradient id="seoulFill" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor={map.fill0} stopOpacity={map.fill0Opacity}/>
            <stop offset="100%" stopColor={map.fill1} stopOpacity={map.fill1Opacity}/>
          </radialGradient>
          {/* 외곽선 글로우 */}
          <filter id="outlineGlow" x="-8%" y="-8%" width="116%" height="116%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          {/* 선택 구 글로우 */}
          <filter id="dotGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* 배경 */}
        <rect width="460" height="320" fill={map.bg}/>

        {/* 서울 전체 면 채우기 */}
        <polygon
          points={SEOUL_OUTLINE}
          fill="url(#seoulFill)"
          stroke="none"
        />

        {/* 외곽선 글로우 레이어 (두껍고 흐림) */}
        <polygon
          points={SEOUL_OUTLINE}
          fill="none"
          stroke={map.outlineGlow}
          strokeWidth="6"
          strokeLinejoin="round"
          filter="url(#outlineGlow)"
        />

        {/* 외곽선 실선 (얇고 선명) */}
        <polygon
          points={SEOUL_OUTLINE}
          fill="none"
          stroke={map.outline}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* 한강 */}
        <path d={HANGANG} fill={map.river} opacity={isLight ? "0.86" : "0.65"}/>
        <path d="M0,170 C80,156 150,196 220,178 C300,156 360,196 460,176 L460,182 C360,202 300,162 220,184 C150,202 80,162 0,176 Z"
          fill={map.riverHi} opacity={isLight ? "0.28" : "0.3"}/>
        <text x="232" y="192" textAnchor="middle"
          fontFamily="Pretendard,'Malgun Gothic',sans-serif"
          fontSize="9" fill={map.riverText} letterSpacing="2">한 강</text>

        {/* 구 이름 + 점 */}
        <g fontFamily="Pretendard,'Malgun Gothic',sans-serif">
          {guEntries.map(gu => {
            const { cx, cy } = gu.coord;
            const isSel = selectedGu?.name === gu.name;
            const isHov = hoveredGu === gu.name;
            const customTextOffset = {
              "용산구": -16,
            };
            const onRiver = cy >= 165 && cy <= 202;
            const textY =
              customTextOffset[gu.name] !== undefined
                ? cy + customTextOffset[gu.name]
                : onRiver
                  ? cy + 13
                  : cy - 7;

            return (
              <g key={gu.name} style={{ cursor: "pointer" }}
                onClick={e => { e.stopPropagation(); onSelectGu(gu); }}
                onMouseEnter={() => setHoveredGu(gu.name)}
                onMouseLeave={() => setHoveredGu(null)}
              >
                {/* 선택 링 + 펄스 */}
                {isSel && (
                  <>
                    <circle cx={cx} cy={cy} r={16}
                      fill="rgba(255,170,51,0.15)"
                      stroke="rgba(255,170,51,0.65)" strokeWidth="1.5"
                      filter="url(#dotGlow)"/>
                    <circle cx={cx} cy={cy}
                      r={22 + (pulse % 30) * 0.45}
                      fill="none"
                      stroke="rgba(255,170,51,0.28)" strokeWidth="1"
                      opacity={Math.max(0, 0.4 - (pulse % 30) * 0.013)}/>
                  </>
                )}
                {isHov && !isSel && (
                  <circle cx={cx} cy={cy} r={10}
                    fill="rgba(78,166,255,0.12)"
                    stroke="#4ea6ff" strokeWidth="0.8" opacity="0.75"/>
                )}

                {/* 점 */}
                <circle cx={cx} cy={cy}
                  r={isSel ? 5.5 : isHov ? 4 : 3}
                  fill={isSel ? "#ffaa33" : "#4ea6ff"}
                  stroke={isSel ? map.dotStroke : isHov ? map.dotStroke : "none"}
                  strokeWidth={isSel ? "1.5" : "0.8"}
                  opacity="0.95"/>

                {/* 라벨 */}
                <text x={cx} y={textY} textAnchor="middle"
                  fill={isSel ? "#ffaa33" : isHov ? map.labelHover : map.label}
                  fontSize={isSel ? "10.5" : "9"}
                  fontWeight={isSel ? "700" : "400"}
                  opacity={isSel ? 1 : isHov ? 1 : 0.88}>
                  {gu.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
