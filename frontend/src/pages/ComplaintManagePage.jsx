import { useState, useEffect, useCallback, useMemo } from "react";
import { GU_LIST } from "../constants/seoulGeoData";
import AppHeader from "../components/common/AppHeader";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

const V = {
  bg0: "var(--syncro-bg0)", bg1: "var(--syncro-bg1)", line: "var(--syncro-line)",
  ink0: "var(--syncro-ink0)", ink1: "var(--syncro-ink1)", ink2: "var(--syncro-ink2)", ink3: "var(--syncro-ink3)",
  grn: "#2ee07a", red: "#ff5566", org: "#ffaa33", blu: "#4ea6ff",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR',system-ui,sans-serif",
};

const STATUS_META = {
  "접수":   { color: V.org, next: "처리중" },
  "처리중": { color: V.blu, next: "완료"   },
  "완료":   { color: V.grn, next: null     },
};

const CATEGORIES = [
  "전체", "도로 파손/균열", "신호등 오작동", "불법 주정차", "노면 침수/결빙",
  "가로등 불량/소등", "교통표지판 훼손", "공사구간 미표시", "보행자 위험구간",
  "이륜차 불법 운행", "과속/난폭운전", "도로 청결 불량", "횡단보도 파손", "소음/진동", "기타",
];

function PhotoModal({ urls, onClose }) {
  const [idx, setIdx] = useState(0);
  const src = urls[idx]?.startsWith("http") ? urls[idx] : `${API_BASE}${urls[idx]}`;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "relative" }}>
        <img src={src} alt="" style={{ maxWidth: "80vw", maxHeight: "75vh", objectFit: "contain", borderRadius: 2, display: "block" }} />
        {urls.length > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
            {urls.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)}
                style={{ width: 8, height: 8, borderRadius: "50%", background: i === idx ? V.org : V.ink3, border: "none", cursor: "pointer", padding: 0 }} />
            ))}
          </div>
        )}
        <button onClick={onClose} style={{ position: "absolute", top: -12, right: -12, width: 30, height: 36, background: V.bg1, border: `1px solid ${V.line}`, borderRadius: "50%", color: V.ink1, cursor: "pointer", fontSize: 18 }}>✕</button>
      </div>
    </div>
  );
}

export default function ComplaintManagePage({
  onBack,
  onGoMain,
  onGoMap,
  onGoNews,
  onGoCctv,
  onGoSimulation,
  onGoComplaints,
  onGoMyPage,
  onLogout,
  headerSelectedGu,
  notifQueue = [],
  onDismissNotif,
  themeMode,
  onToggleTheme,
}) {
  const [complaints,     setComplaints]   = useState([]);
  const [allComplaints,  setAllComplaints] = useState([]); // 사이드바 카운트용 전체
  const [loading,        setLoading]      = useState(true);
  const [selectedGu,     setSelectedGu]  = useState(null);
  const [filterStatus,   setFilterStatus] = useState("전체");
  const [filterCategory, setFilterCat]   = useState("전체");
  const [search,         setSearch]      = useState("");
  const [photoModal,     setPhotoModal]  = useState(null);
  const [now,            setNow]         = useState(new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const fmt  = n => String(n).padStart(2, "0");
  const time = `${now.getFullYear()}-${fmt(now.getMonth()+1)}-${fmt(now.getDate())} ${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;

  // 전체 민원 (사이드바 카운트용) — 마운트 시 1회 + 새로고침 시
  const loadAll = useCallback(() => {
    fetch(`${API_BASE}/api/complaints`)
      .then(r => r.json())
      .then(data => Array.isArray(data) && setAllComplaints(data))
      .catch(() => {});
  }, []);

  // 선택된 구의 민원 (테이블용)
  const load = useCallback(() => {
    setLoading(true);
    const url = selectedGu
      ? `${API_BASE}/api/complaints?guName=${encodeURIComponent(selectedGu)}`
      : `${API_BASE}/api/complaints`;
    fetch(url)
      .then(r => r.json())
      .then(data => { setComplaints(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedGu]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { load(); }, [load]);

  const patchStatus = async (id, status) => {
    await fetch(`${API_BASE}/api/complaints/${id}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
    loadAll();
  };

  const deleteComplaint = async (id) => {
    if (!window.confirm("민원을 삭제하시겠습니까? 첨부 사진도 함께 삭제됩니다.")) return;
    await fetch(`${API_BASE}/api/complaints/${id}`, { method: "DELETE" });
    load();
    loadAll();
  };

  const reload = () => { load(); loadAll(); };

  // 구별 미처리(접수+처리중) 건수 맵
  const guPendingMap = useMemo(() => {
    const map = {};
    allComplaints.forEach(c => {
      if (!c.guName) return;
      if (!map[c.guName]) map[c.guName] = 0;
      if (c.status !== "완료") map[c.guName]++;
    });
    return map;
  }, [allComplaints]);

  // 미처리 건수 내림차순 정렬된 GU_LIST
  const sortedGuList = useMemo(() =>
    [...GU_LIST].sort((a, b) => (guPendingMap[b.name] || 0) - (guPendingMap[a.name] || 0)),
  [guPendingMap]);

  // ── 필터 적용 (클라이언트 — 구 필터는 백엔드에서 처리) ──────
  const filtered = useMemo(() => {
    let list = complaints;
    if (filterStatus   !== "전체") list = list.filter(c => c.status   === filterStatus);
    if (filterCategory !== "전체") list = list.filter(c => c.category === filterCategory);
    if (search.trim()) {
      const q = search.trim();
      list = list.filter(c =>
        c.title?.includes(q) || c.address?.includes(q) || c.userName?.includes(q)
      );
    }
    return list;
  }, [complaints, filterStatus, filterCategory, search]);

  const counts = {
    전체: complaints.length,
    접수: complaints.filter(c => c.status === "접수").length,
    처리중: complaints.filter(c => c.status === "처리중").length,
    완료: complaints.filter(c => c.status === "완료").length,
  };

  const fmtDt = dt => dt
    ? new Date(dt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div style={{ fontFamily: V.sans, background: V.bg0, color: V.ink0, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── 공통 헤더 ── */}
      <AppHeader
        activePage="complaints"
        selectedGu={null}
        statusText={`민원 ${counts.전체}건`}
        statusLive={counts.전체 > 0}
        onGoMain={onGoMain}
        onGoMap={onGoMap}
        onGoNews={onGoNews}
        onGoCctv={onGoCctv}
        onGoSimulation={onGoSimulation}
        onGoComplaints={onGoComplaints}
        onGoMyPage={onGoMyPage}
        onLogout={onLogout}
        complaintCount={counts.접수 + counts.처리중}
        notifQueue={notifQueue}
        onDismissNotif={onDismissNotif}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        wrapRightExtra={false}
        rightExtra={
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <button onClick={reload} style={{ height: 40, padding: "0 18px", background: "var(--syncro-icon-button-bg)", border: `1px solid ${V.line}`, borderRadius: 999, color: V.ink1, fontSize: 12, cursor: "pointer", fontFamily: V.mono, whiteSpace: "nowrap" }}>새로고침</button>
          </div>
        }
      />

      {/* ── 메인 (2컬럼) ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ── 좌측 구 사이드바 ── */}
        <div style={{ width: 210, borderRight: `1px solid ${V.line}`, overflowY: "auto", flexShrink: 0 }}>
          <div style={{ padding: "12px 16px 8px", fontSize: 12, color: V.ink3, fontWeight: 600, letterSpacing: 1, fontFamily: V.mono }}>구 선택</div>

          {/* 전체 */}
          <div onClick={() => setSelectedGu(null)}
            style={{ padding: "9px 16px", cursor: "pointer", background: !selectedGu ? "var(--syncro-selected-bg)" : "transparent", borderLeft: !selectedGu ? `2px solid ${V.blu}` : "2px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onMouseEnter={e => { if (selectedGu) e.currentTarget.style.background = "var(--syncro-selected-bg)"; }}
            onMouseLeave={e => { if (selectedGu) e.currentTarget.style.background = "transparent"; }}>
            <span style={{ fontSize: 14, fontWeight: !selectedGu ? 700 : 400, color: !selectedGu ? V.ink0 : V.ink1 }}>전체 보기</span>
          </div>

          {/* 25개 구 — 미처리 건수 내림차순 */}
          {sortedGuList.map(g => {
            const isSel = selectedGu === g.name;
            const pending = guPendingMap[g.name] || 0;
            return (
              <div key={g.name} onClick={() => setSelectedGu(g.name)}
                style={{ padding: "9px 16px", cursor: "pointer", background: isSel ? "var(--syncro-selected-bg)" : "transparent", borderLeft: isSel ? `2px solid ${V.blu}` : "2px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "var(--syncro-selected-bg)"; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ fontSize: 14, fontWeight: isSel ? 700 : 400, color: isSel ? V.ink0 : pending > 0 ? V.ink1 : V.ink3 }}>{g.name}</span>
                {pending > 0 && (
                  <span style={{ fontFamily: V.mono, fontSize: 12.5, fontWeight: 700, color: V.org }}>{pending}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── 우측: 필터 + 테이블 ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

          {/* 필터 툴바 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: `1px solid ${V.line}`, flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: V.ink0 }}>
              {selectedGu ?? "전체"}
              <span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink2, fontWeight: 400, marginLeft: 8 }}>{filtered.length}건</span>
            </span>

            <span style={{ fontFamily: V.mono, fontSize: 12.5, color: V.ink3, letterSpacing: ".5px", marginLeft: 8 }}>STATUS</span>
            <div style={{ display: "flex", background: "var(--syncro-input-bg)", border: `1px solid ${V.line}`, borderRadius: 2 }}>
              {["전체", "접수", "처리중", "완료"].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  style={{ background: filterStatus === s ? "var(--syncro-selected-bg)" : "transparent", border: 0, borderRight: `1px solid ${V.line}`, color: filterStatus === s ? V.ink0 : V.ink3, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: V.mono }}>
                  {s}{s !== "전체" ? ` (${counts[s] ?? 0})` : ` (${counts.전체})`}
                </button>
              ))}
            </div>

            <select value={filterCategory} onChange={e => setFilterCat(e.target.value)}
              style={{ height: 32, padding: "0 10px", background: "var(--syncro-input-bg)", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink1, fontSize: 13, fontFamily: V.sans, outline: "none", cursor: "pointer" }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <div style={{ marginLeft: "auto", height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: "var(--syncro-input-bg)", border: `1px solid ${V.line}`, borderRadius: 2, minWidth: 300 }}>
              <span style={{ fontFamily: V.mono, color: V.ink3, fontSize: 13 }}>⌕</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="제목, 주소, 신청자 검색"
                style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: V.ink0, fontSize: 13, fontFamily: V.sans }} />
            </div>
          </div>

          {/* 테이블 */}
          <div style={{ flex: 1, overflow: "auto" }}>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: V.ink2, fontFamily: V.mono, fontSize: 14 }}>로딩 중...</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["#", "상태", "분류", "제목", "주소", "신청자", "접수 일시", "사진", "처리"].map((h, i) => (
                      <th key={h} style={{ position: "sticky", top: 0, background: "var(--syncro-input-bg)", borderBottom: `1px solid ${V.line}`, textAlign: i >= 7 ? "center" : "left", fontFamily: V.mono, fontSize: 12.5, fontWeight: 700, color: V.ink2, letterSpacing: ".5px", textTransform: "uppercase", padding: "8px 14px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: V.ink3, fontFamily: V.mono, fontSize: 14 }}>
                      {loading ? "로딩 중..." : selectedGu ? `${selectedGu}에 접수된 민원이 없습니다` : "민원이 없습니다"}
                    </td></tr>
                  ) : filtered.map((c, i) => {
                    const meta = STATUS_META[c.status] || STATUS_META["접수"];
                    const photos = c.photoUrls || [];
                    return (
                      <tr key={c.id} style={{ background: i % 2 === 0 ? "rgba(255,255,255,.015)" : V.bg0 }}>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, fontFamily: V.mono, fontSize: 12, color: V.ink3 }}>#{c.id}</td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}` }}>
                          <span style={{ fontFamily: V.mono, fontSize: 14, fontWeight: 700, color: meta.color }}>{c.status}</span>
                        </td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, color: V.ink2, fontSize: 13, whiteSpace: "nowrap" }}>{c.category}</td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, color: V.ink0, fontWeight: 600, fontSize: 14, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, color: V.ink2, fontSize: 13, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.address}</td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, color: V.ink1, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>{c.userName}</td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, fontFamily: V.mono, fontSize: 13, color: V.ink2, whiteSpace: "nowrap" }}>{fmtDt(c.createdAt)}</td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, textAlign: "center" }}>
                          {photos.length > 0 ? (
                            <button onClick={() => setPhotoModal(photos)}
                              style={{ background: "transparent", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink1, fontSize: 13, cursor: "pointer", padding: "4px 9px", fontFamily: V.mono }}>
                              📷 {photos.length}
                            </button>
                          ) : <span style={{ color: V.ink3, fontSize: 13 }}>—</span>}
                        </td>
                        <td style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, textAlign: "center", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                            {meta.next ? (
                              <button onClick={() => patchStatus(c.id, meta.next)}
                                style={{ padding: "4px 12px", background: "transparent", border: `1px solid ${V.ink3}`, borderRadius: 2, color: V.ink2, fontSize: 13, cursor: "pointer", fontFamily: V.mono, transition: "all .15s" }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = meta.color; e.currentTarget.style.color = meta.color; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = V.ink3; e.currentTarget.style.color = V.ink2; }}>
                                → {meta.next}
                              </button>
                            ) : <span style={{ fontFamily: V.mono, fontSize: 13, color: V.grn }}>✓ 완료</span>}
                            <button onClick={() => deleteComplaint(c.id)}
                              style={{ padding: "4px 10px", background: "transparent", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink3, fontSize: 13, cursor: "pointer", fontFamily: V.mono, transition: "all .15s" }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = V.red; e.currentTarget.style.color = V.red; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = V.line; e.currentTarget.style.color = V.ink3; }}>
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 하단 */}
          <div style={{ height: 32, display: "flex", alignItems: "center", padding: "0 16px", borderTop: `1px solid ${V.line}`, background: V.bg1, fontFamily: V.mono, fontSize: 12, color: V.ink3, gap: 12, flexShrink: 0 }}>
            <span>총 {filtered.length}건</span>
            <span style={{ color: V.line }}>·</span>
            <span>전체 {complaints.length}건</span>
            <span style={{ marginLeft: "auto" }}>Syncro 민원 관리 시스템</span>
          </div>
        </div>
      </div>

      {photoModal && <PhotoModal urls={photoModal} onClose={() => setPhotoModal(null)} />}
    </div>
  );
}
