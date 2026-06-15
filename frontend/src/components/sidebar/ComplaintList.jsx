const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

const STATUS_META = {
  "접수":   { color: "#ffaa33", bg: "#1a1206", bd: "#3a2a14", next: "처리중" },
  "처리중": { color: "#4ea6ff", bg: "#0a1020", bd: "#1a2a40", next: "완료"  },
  "완료":   { color: "#2ee07a", bg: "#0c1a12", bd: "#1a3a24", next: null    },
};

const V = {
  bg0: "var(--syncro-bg0)", bg1: "var(--syncro-bg1)", line: "var(--syncro-line)",
  ink0: "var(--syncro-ink0)", ink1: "var(--syncro-ink1)", ink2: "var(--syncro-ink2)", ink3: "var(--syncro-ink3)",
  org: "#ffaa33", blu: "#4ea6ff", grn: "#2ee07a", red: "#ff5566",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR',system-ui,sans-serif",
};

async function patchStatus(id, status) {
  await fetch(`${API_BASE}/api/complaints/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export default function ComplaintList({ complaints, onSelect, selected, onStatusChange }) {
  const pending  = complaints.filter(c => c.status === "접수").length;
  const progress = complaints.filter(c => c.status === "처리중").length;
  const done     = complaints.filter(c => c.status === "완료").length;

  const handleNext = async (e, c) => {
    e.stopPropagation();
    const next = STATUS_META[c.status]?.next;
    if (!next) return;
    await patchStatus(c.id, next);
    onStatusChange?.();
  };

  const fmt = dt => dt
    ? new Date(dt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "14px 16px", fontFamily: V.sans, boxShadow: "var(--syncro-inner-shadow)" }}>

      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: V.ink0 }}>민원 현황</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["접수", pending, V.org], ["처리중", progress, V.blu], ["완료", done, V.grn]].map(([label, cnt, color]) => (
            <span key={label} style={{ fontFamily: V.mono, fontSize: 10, color, fontWeight: 700 }}>
              {label} {cnt}
            </span>
          ))}
        </div>
      </div>

      {/* 목록 */}
      {complaints.filter(c => c.status !== "완료").length === 0 ? (
        <div style={{ fontSize: 13, color: V.ink3, textAlign: "center", padding: "10px 0" }}>접수된 민원 없음</div>
      ) : (
        complaints.filter(c => c.status !== "완료").map(c => {
          const meta = STATUS_META[c.status] || STATUS_META["접수"];
          const isSel = selected?.id === c.id;
          return (
            <div
              key={c.id}
              onClick={() => onSelect?.(c)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "9px 10px", borderRadius: 2, marginBottom: 5,
                background: isSel ? meta.bg : "transparent",
                border: `1px solid ${isSel ? meta.bd : V.line}`,
                cursor: "pointer",
              }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "var(--syncro-selected-bg)"; }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
            >
              {/* 상태 점 */}
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0, marginTop: 4 }} />

              {/* 내용 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontFamily: V.mono, color: meta.color, fontWeight: 700 }}>{c.status}</span>
                  <span style={{ fontSize: 11, color: V.ink2, fontFamily: V.mono }}>{c.category?.substring(0, 7)}</span>
                </div>
                <div style={{ fontSize: 13, color: V.ink0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                {c.content && (
                  <div style={{ fontSize: 11, color: V.ink1, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>{c.content}</div>
                )}
                <div style={{ fontSize: 11, color: V.ink2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.address}
                </div>
                <div style={{ fontSize: 10, color: V.ink3, fontFamily: V.mono, marginTop: 2 }}>{c.userName} · {fmt(c.createdAt)}</div>
              </div>

              {/* 상태 전환 버튼 */}
              {meta.next && (
                <button
                  onClick={e => handleNext(e, c)}
                  title={`${meta.next}으로 변경`}
                  style={{
                    flexShrink: 0, padding: "3px 8px", background: "transparent",
                    border: `1px solid ${V.ink3}`, borderRadius: 2,
                    color: V.ink2, fontSize: 10, fontFamily: V.mono,
                    cursor: "pointer", whiteSpace: "nowrap", alignSelf: "center",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = meta.color; e.currentTarget.style.color = meta.color; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = V.ink3; e.currentTarget.style.color = V.ink2; }}
                >
                  → {meta.next}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
