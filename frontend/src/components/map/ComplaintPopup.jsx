import { V } from "../../constants/theme";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

const STATUS_COLOR = { "접수": V.org, "처리중": V.blu, "완료": V.grn };

export default function ComplaintPopup({ complaint, onClose }) {
  const statusColor = STATUS_COLOR[complaint.status] || V.ink2;
  const photos = complaint.photoUrls || [];

  const fmt = dt => dt ? new Date(dt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: V.sans }}>
      <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, width: photos.length > 0 ? 720 : 480, maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>

        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${V.line}`, background: V.bg0, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: V.mono, fontSize: 10, color: V.org, letterSpacing: ".5px", fontWeight: 700 }}>민원</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: V.ink0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{complaint.title}</span>
          <span style={{ fontFamily: V.mono, fontSize: 11, color: statusColor, fontWeight: 700 }}>{complaint.status || "접수"}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, background: "transparent", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink2, cursor: "pointer", fontSize: 15, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["민원 분류", complaint.category || "—"],
                ["담당과",   complaint.department || "—"],
                ["접수자",   complaint.userName || "—"],
                ["접수 일시", fmt(complaint.createdAt)],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: "8px 10px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2 }}>
                  <div style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: ".4px", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 12, color: V.ink0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                </div>
              ))}
            </div>

            {complaint.aiReason && (
              <div style={{ padding: "10px 12px", background: V.bg2, border: `1px solid ${V.line}`, borderRadius: 2 }}>
                <div style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: ".4px", marginBottom: 5 }}>AI 분석</div>
                <div style={{ fontSize: 12, color: V.ink1, lineHeight: 1.6 }}>· {complaint.aiReason}</div>
              </div>
            )}

            <div style={{ padding: "10px 12px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, flex: 1 }}>
              <div style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: ".4px", marginBottom: 6 }}>민원 내용</div>
              <div style={{ fontSize: 13, color: V.ink1, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{complaint.content || "내용 없음"}</div>
            </div>

            <div style={{ padding: "8px 10px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2 }}>
              <div style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: ".4px", marginBottom: 3 }}>위치</div>
              <div style={{ fontSize: 12, color: V.ink0 }}>{complaint.address || "—"}</div>
            </div>
          </div>

          {photos.length > 0 && (
            <div style={{ width: 220, flexShrink: 0, borderLeft: `1px solid ${V.line}`, display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
              <a href={photos[0].startsWith("http") ? photos[0] : `${API_BASE}${photos[0]}`} target="_blank" rel="noreferrer">
                <img src={photos[0].startsWith("http") ? photos[0] : `${API_BASE}${photos[0]}`} alt="민원 사진"
                  style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 4, border: `1px solid ${V.line}`, display: "block", cursor: "pointer" }} />
              </a>
              {photos.slice(1).map((url, i) => {
                const src = url.startsWith("http") ? url : `${API_BASE}${url}`;
                return (
                  <a key={i} href={src} target="_blank" rel="noreferrer">
                    <img src={src} alt="" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 4, border: `1px solid ${V.line}`, display: "block", cursor: "pointer" }} />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${V.line}`, background: V.bg0, fontFamily: V.mono, fontSize: 11, color: V.ink2, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span>민원번호 #{complaint.id || "—"}</span>
          <span style={{ color: V.line }}>·</span>
          <span>📍 {complaint.address || "위치 정보 없음"}</span>
        </div>
      </div>
    </div>
  );
}
