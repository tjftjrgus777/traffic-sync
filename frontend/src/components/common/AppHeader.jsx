import { useEffect, useState } from "react";

const V = {
  bg0: "#000", line: "#1a1a1a", ink0: "#e7ecf5", ink1: "#aab4c8", ink2: "#7a7a7a", ink3: "#3a3a3a",
  grn: "#2ee07a", org: "#ffaa33", blu: "#4ea6ff", red: "#ff5566",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR','Malgun Gothic',system-ui,sans-serif",
};

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return mobile;
}

export default function AppHeader({
  activePage = "main",
  selectedGu,
  statusText,
  statusLive = false,
  onGoMain,
  onGoMap,
  onGoNews,
  onGoCctv,
  onGoSimulation,
  onGoComplaints,
  onGoMyPage,
  onLogout,
  rightExtra,
  fetchMsg,
  complaintCount = 0,
  notifQueue = [],
  onDismissNotif,
}) {
  const [time, setTime] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 모바일에서 메뉴 열릴 때 바깥 클릭 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!e.target.closest("[data-mobile-menu]")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const tabs = [
    ["통합 대시보드", "main"],
    ["실시간 지도", "map"],
    ["신호 시뮬레이션", "simulation"],
    ["CCTV", "cctv"],
    ["뉴스", "news"],
    ["민원 관리", "complaints"],
  ];

  const go = (tab) => {
    setMenuOpen(false);
    if (tab === "main") return onGoMain?.();
    if (tab === "map") return onGoMap?.(selectedGu);
    if (tab === "news") return onGoNews?.();
    if (tab === "cctv") return onGoCctv?.();
    if (tab === "simulation") return onGoSimulation?.();
    if (tab === "complaints") return onGoComplaints?.();
  };

  // ── 모바일 헤더 ──────────────────────────────────────────────────
  if (isMobile) {
    const activeLabel = tabs.find(([, t]) => t === activePage)?.[0] ?? "메뉴";
    return (
      <div style={{ background: V.bg0, borderBottom: `1px solid ${V.line}`, padding: "0 12px", height: 52, display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 100, fontFamily: V.sans, flexShrink: 0 }}>

        {/* 로고 */}
        <button onClick={onGoMain} style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: 0, padding: 0, cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, display: "grid", placeItems: "center", background: "#0a0a0a", border: `1px solid ${V.line}`, flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: V.grn, display: "block" }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, color: V.ink0, whiteSpace: "nowrap" }}>Syncro</span>
        </button>

        {/* 현재 페이지명 */}
        <span style={{ fontSize: 11, color: V.ink2, flexShrink: 0 }}>/ {activeLabel}</span>

        {/* 선택된 구 */}
        {selectedGu && (
          <span style={{ fontSize: 11, color: V.org, flexShrink: 0 }}>· {selectedGu.name}</span>
        )}

        {/* LIVE 상태 */}
        {statusText && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: V.ink1, flexShrink: 0 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusLive ? V.grn : V.ink3, display: "inline-block" }} />
            LIVE
          </span>
        )}

        {/* rightExtra (음소거 버튼 등) */}
        {rightExtra && <div style={{ flexShrink: 0 }}>{rightExtra}</div>}

        {/* 로그아웃 버튼 */}
        {onLogout && (
          <button
            onClick={() => { localStorage.removeItem("ts_user"); onLogout(); }}
            style={{ background: "transparent", border: "1px solid #3a1820", borderRadius: 999, padding: "5px 10px", color: V.red, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            로그아웃
          </button>
        )}

        {/* 햄버거 메뉴 버튼 */}
        <button
          data-mobile-menu
          onClick={() => setMenuOpen(o => !o)}
          style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${V.line}`, borderRadius: 6, width: 36, height: 36, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}
        >
          {[0, 1, 2].map(i => (
            <span key={i} style={{ width: 16, height: 1.5, background: V.ink1, borderRadius: 2, display: "block" }} />
          ))}
        </button>

        {/* 드롭다운 메뉴 */}
        {menuOpen && (
          <div
            data-mobile-menu
            style={{ position: "fixed", top: 52, right: 0, left: 0, background: "#0d0d0d", borderBottom: `1px solid ${V.line}`, zIndex: 200, padding: "8px 0" }}
          >
            {tabs.map(([label, tab]) => {
              const isActive = tab === activePage;
              const isCivil = tab === "complaints";
              return (
                <button
                  key={tab}
                  onClick={() => go(tab)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 20px", background: isActive ? "#111" : "transparent", border: 0, color: isActive ? V.blu : "#fff", fontSize: 15, fontWeight: isActive ? 700 : 400, cursor: "pointer", textAlign: "left", fontFamily: V.sans, position: "relative" }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: isActive ? V.blu : isCivil ? V.org : V.ink3, display: "inline-block", flexShrink: 0 }} />
                  {label}
                  {isCivil && complaintCount > 0 && (
                    <span style={{ marginLeft: "auto", background: V.org, borderRadius: 999, fontSize: 11, fontWeight: 700, color: "#000", padding: "1px 7px" }}>
                      {complaintCount}
                    </span>
                  )}
                </button>
              );
            })}
            {onGoMyPage && (
              <button
                onClick={() => { setMenuOpen(false); onGoMyPage(); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "13px 20px", background: "transparent", border: 0, borderTop: `1px solid ${V.line}`, color: V.ink1, fontSize: 15, cursor: "pointer", textAlign: "left", fontFamily: V.sans }}
              >
                마이페이지
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── 데스크톱 헤더 (기존 그대로) ──────────────────────────────────
  return (
    <div style={{ background: V.bg0, borderBottom: `1px solid ${V.line}`, padding: "0 20px", height: 92, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, position: "sticky", top: 0, zIndex: 100, fontFamily: V.sans, overflowX: "clip", overflowY: "visible", whiteSpace: "nowrap" }}>
      <button onClick={onGoMain} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 210, flexShrink: 0, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", fontFamily: V.sans }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: V.ink0 }}>Syncro 교통 관제 시스템</div>
        </div>
      </button>


      <div style={{ display: "flex", gap: 2, background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 999, padding: 3, flexShrink: 0 }}>
        {tabs.map(([label, tab]) => {
          const isActive = tab === activePage;
          const isCivil  = tab === "complaints";
          const dotColor = isActive ? V.blu : isCivil ? V.org : V.ink3;
          return (
            <div key={tab} style={{ position: "relative" }}>
              <button onClick={() => go(tab)}
                style={{ appearance: "none", border: 0, background: isActive ? "#141414" : "transparent", color: isActive ? V.blu : "#fff", padding: "8px 12px", borderRadius: 999, fontSize: 15, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: isActive ? "inset 0 0 0 1px #2a2a2a" : "none", fontFamily: V.sans, position: "relative", whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1.15 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: isCivil && notifQueue.length > 0 ? V.org : dotColor, display: "inline-block" }} />
                {label}
                {isCivil && notifQueue.length > 0 && (
                  <span style={{ position: "absolute", top: 4, right: 6, minWidth: 16, height: 16, background: V.org, borderRadius: 999, fontFamily: V.mono, fontSize: 9, fontWeight: 700, color: "#000", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                    {notifQueue.length}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {rightExtra && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 4,
            marginTop: 5,
            padding: "3px 5px",
            border: `1px solid ${V.line}`,
            borderRadius: 999,
            background: "rgba(255,255,255,0.025)",
            flexShrink: 0,
          }}
        >
          {rightExtra}
        </div>
      )}

      {selectedGu && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 9px", borderRadius: 2, background: "#1a1206", border: "1px solid #3a2a14", color: V.org, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: V.org, display: "inline-block" }} />
          {selectedGu.name} 선택됨
        </div>
      )}
      {fetchMsg && (
        <div
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 2, background: "#0c1a12",
            border: "1px solid #1a3a24", color: V.grn, fontSize: 11, fontWeight: 600, fontFamily: V.mono, whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          ✓ {fetchMsg}
        </div>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, whiteSpace: "nowrap" }}>
        {statusText && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", border: `1px solid ${V.line}`, background: V.bg0, borderRadius: 2, fontFamily: V.mono, fontSize: 12, color: V.ink1, whiteSpace: "nowrap",  flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusLive ? V.grn : V.ink3, display: "inline-block" }} />
            {statusText}
          </span>
        )}

        

        

       

        {/* <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink0, letterSpacing: ".3px" }}>
          <span style={{ color: V.ink2, marginRight: 6 }}>{time.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span>
          {time.toLocaleTimeString("ko-KR")}
        </span> */}
        
        
        <div
          style={{
            display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", fontFamily: V.mono, gap: 4,
             color: V.ink0, letterSpacing: ".2px", whiteSpace: "nowrap", flexShrink: 0, 
          }}
        >
          <span style={{ color: V.ink2, fontSize: 11, lineHeight: 1.15 }}>
            {time.toLocaleDateString("ko-KR", {
              year: "numeric", month: "long", day: "numeric", weekday: "short", 
            })}
          </span>
          <span style={{ color: V.ink0, fontSize: 12, fontWeight: 600 }}>
            {time.toLocaleTimeString("ko-KR")}
          </span>
         
        </div>


         {onGoMyPage && (
          <button
            onClick={onGoMyPage}
            title="마이페이지"
            aria-label="마이페이지"
            style={{
              width: 40, height: 40, display: "grid", placeItems: "center", background: "transparent",
              border: `1px solid #a59c9e`, borderRadius: 999, cursor: "pointer", flexShrink: 0,
            }}
          >
            <img src="/icons/user.png" alt=""
              style={{
                width: 20, height: 20, objectFit: "contain", filter: "invert(1)", opacity: 0.95,
              }}
            />
          </button>
        )}

        {onLogout && (
          <button
            onClick={() => {
              localStorage.removeItem("ts_user");
              onLogout();
            }}
            title="로그아웃"
            aria-label="로그아웃"
            style={{
              width: 40, height: 40, display: "grid", placeItems: "center", background: "transparent",
              border: "1px solid #a59c9e", borderRadius: 999, cursor: "pointer", flexShrink: 0,
            }}
          >
            <img src="/icons/logout.png" alt=""
              style={{
                width: 20, height: 20, objectFit: "contain", filter: "invert(1)", opacity: 0.95,
              }}
            />
          </button>
        )}
        
      </div>
    </div>
  );
}
