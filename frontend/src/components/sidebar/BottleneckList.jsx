function speedColor(speed) {
  if (!Number.isFinite(speed)) return "#94a3b8";
  if (speed < 15) return "#ff5566";
  if (speed < 25) return "#ffaa33";
  return "#2ee07a";
}

// 방향 키(north/east/...) → 한글 라벨
const DIR_LABEL = {
  north: "북", east: "동", south: "남", west: "서",
  northeast: "북동", southeast: "남동", southwest: "남서", northwest: "북서",
};

// 가장 막힌 진입 방향을 찾아 "동측 12km/h" 형태로 반환. 방향별 속도가 없으면 null.
function worstDirection(speedByDirection) {
  if (!speedByDirection) return null;
  let worstKey = null;
  let worstSpeed = Infinity;
  for (const [k, v] of Object.entries(speedByDirection)) {
    if (Number.isFinite(v) && v < worstSpeed) {
      worstSpeed = v;
      worstKey = k;
    }
  }
  if (worstKey == null) return null;
  const ws = Number.isFinite(worstSpeed) ? (worstSpeed % 1 === 0 ? worstSpeed : worstSpeed.toFixed(1)) : worstSpeed;
  return `${DIR_LABEL[worstKey] || worstKey}측 진입 ${ws}km/h`;
}

export default function BottleneckList({ bottlenecks, selected, onSelect, crossroadsCount }) {
  return (
    <div style={{ background: "var(--syncro-bg1)", border: "1px solid var(--syncro-line)", borderRadius: 2, padding: "14px 16px", boxShadow: "var(--syncro-inner-shadow)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--syncro-ink0)" }}>
        실시간 병목 현황
      </div>

      {bottlenecks.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--syncro-ink3)", textAlign: "center", padding: "10px 0" }}>
          {crossroadsCount === 0 ? "수신 대기 중..." : "병목 없음 ✓"}
        </div>
      ) : (
        bottlenecks.map(cr => {
          const isSelected = selected?.crsrdId === cr.crsrdId;
          const hasSpeed = Number.isFinite(cr.speed);
          const speed = hasSpeed ? cr.speed : "-";
          const color = speedColor(cr.speed);
          const worst = worstDirection(cr.speedByDirection);
          const congestionLabel = !hasSpeed ? "정보없음"
            : cr.speed < 15 ? "정체"
            : cr.speed < 25 ? "서행"
            : "원활";
          return (
            <div
              key={cr.crsrdId}
              onClick={() => onSelect(cr)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 10px", borderRadius: 2, marginBottom: 6,
                background: isSelected ? `${color}14` : "transparent",
                border: `1px solid ${isSelected ? `${color}72` : "var(--syncro-line)"}`,
                cursor: "pointer",
              }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--syncro-selected-bg)"; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--syncro-ink0)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>
                    {cr.crsrdNm}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--syncro-ink2)", marginTop: 2 }}>
                    {worst || "방향별 속도 수집 대기"}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 14, color: color, fontWeight: 800, fontFamily: "monospace" }}>
                  {speed}<span style={{ fontSize: 11 }}>km/h</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--syncro-ink2)", marginTop: 2 }}>
                  {congestionLabel}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
