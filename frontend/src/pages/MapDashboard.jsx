import { useState, useEffect, useCallback, useRef } from "react";

function useIsMobile(bp = 768) {
  const [m, setM] = useState(() => window.innerWidth < bp);
  useEffect(() => {
    const h = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [bp]);
  return m;
}
import KakaoMapView from "../components/map/KakaoMapView";
import SignalPanel from "../components/map/SignalPanel";
import RoadViewModal from "../components/map/RoadViewModal";
import CctvModal from "../components/map/CctvModal";
import BottleneckList from "../components/sidebar/BottleneckList";
import RiskList from "../components/sidebar/RiskList";
import ComplaintList from "../components/sidebar/ComplaintList";
import AIChatBot from "../components/sidebar/AIChatBot";
import ComplaintPopup from "../components/map/ComplaintPopup";
import { riskGradeValue } from "../utils/signalUtils";
import AppHeader from "../components/common/AppHeader";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");


const WEATHER = { icon: "🌤️", temp: "21°C", desc: "맑음", humidity: "65%" };
const TABS = [
  { key: "map",  label: "🗺️ 실시간 지도" }
];

const CHAT_W = 480;
const CHATBOT_ICON = "/icons/chatbot.webp";

export default function MapDashboard({ onGoMain, onGoCctv, onGoNews, onGoSimulation, onGoMyPage, onLogout, onGoComplaints, selectedGu, wsData, setWsData, initialCenter, wsStatus, lastUpdate, stations = [], isMuted, onToggleMute, isMicActive, onToggleMic, notifQueue = [], onDismissNotif, themeMode, onToggleTheme, }) {
  const [time,         setTime]         = useState(new Date());
  const [selected,     setSelected]     = useState(null);
  const [activeTab,    setActiveTab]    = useState("map");
  const [showRoadView, setShowRoadView] = useState(false);
  const [selectedCctv, setSelectedCctv] = useState(null);
  const [chatOpen,     setChatOpen]     = useState(false);
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTouchY = useRef(null);
  const [signalPanelOpen, setSignalPanelOpen] = useState(true);
  const [complaints,       setComplaints]     = useState([]);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [complaintMapCenter, setComplaintMapCenter] = useState(null);
  const prevComplaintIdsRef = useRef(new Set());
  const isLight = themeMode === "light";

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setSelected(prev => {
      if (!prev && wsData.length > 0 && signalPanelOpen) return wsData[0];
      if (prev) return wsData.find(c => c.crsrdId === prev.crsrdId) || prev;
      return prev;
    });
  }, [wsData, signalPanelOpen]);

  const selectCr = useCallback(cr => {
    setSelected(cr);
    setSignalPanelOpen(true);
    setActiveTab("map");
  }, []);

  const riskRank = c => {
    const grade = riskGradeValue(c.riskGrade);
    const score = Number.isFinite(c.riskScore) ? c.riskScore : -1;
    return grade == null ? -1 : grade * 100000 + score;
  };
  const isHighRisk = c => (riskGradeValue(c.riskGrade) ?? 0) >= 3;

  // ── 브라우저 알림 권한 요청 ───────────────────────────────────
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // ── 민원 폴링 + 신규 민원 알림 (30초 간격) ───────────────────
  const fetchComplaints = useCallback(() => {
    const guParam = selectedGu?.name ? `?guName=${encodeURIComponent(selectedGu.name)}` : "";
    fetch(`${API_BASE}/api/complaints${guParam}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (!Array.isArray(data)) return;
        setComplaints(data);

        const prevIds = prevComplaintIdsRef.current;
        if (prevIds.size > 0) {
          const newOnes = data.filter(c => !prevIds.has(String(c.id)));
          newOnes.forEach(c => {
            if (Notification.permission === "granted") {
              new Notification("새 민원 접수", {
                body: `[${c.category}] ${c.title}\n📍 ${c.address}`,
                icon: "/favicon.ico",
              });
            }
          });
        }
        prevComplaintIdsRef.current = new Set(data.map(c => String(c.id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchComplaints();
    const id = setInterval(fetchComplaints, 5000);
    return () => clearInterval(id);
  }, [fetchComplaints, selectedGu?.name]);

  const bottlenecks = [...wsData]
    .filter(c => c.congestion === "정체" || c.congestion === "혼잡" || c.congestion === "서행")
    .sort((a, b) => (a.speed ?? Number.MAX_SAFE_INTEGER) - (b.speed ?? Number.MAX_SAFE_INTEGER));
  const risks       = [...wsData].filter(isHighRisk).sort((a, b) => riskRank(b) - riskRank(a));
  const validSpeeds = wsData.map(c => c.speed).filter(Number.isFinite);
  const avgSpeed    = validSpeeds.length ? Math.round(validSpeeds.reduce((a, v) => a + v, 0) / validSpeeds.length) : "—";
  const isConn      = wsStatus === "연결됨";

  return (
    <div style={{ fontFamily: "'Noto Sans KR','Malgun Gothic',sans-serif", background: "var(--syncro-bg0)", color: "var(--syncro-ink0)", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* 공통 헤더 */}
      <AppHeader
        activePage="map"
        selectedGu={selectedGu}
        statusText={isConn ? "LIVE · V2X 연결됨" : wsStatus}
        statusLive={isConn}
        onGoMain={onGoMain}
        onGoMap={() => {}}
        onGoNews={onGoNews}
        onGoCctv={onGoCctv}
        onGoSimulation={onGoSimulation}
        onGoComplaints={onGoComplaints}
        onGoMyPage={onGoMyPage}
        onLogout={onLogout}
        complaintCount={complaints.filter(c => c.status !== "완료").length}
        notifQueue={notifQueue}
        onDismissNotif={onDismissNotif}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        rightExtra={(
          <>
            {onToggleMute && (
              <button
                onClick={onToggleMute}
                title={isMuted ? "음소거 해제" : "음소거"}
                style={{
                  background: isMuted ? "var(--syncro-danger-bg)" : "var(--syncro-icon-button-bg)",
                  border: `1px solid ${isMuted ? "var(--syncro-danger-bd)" : "var(--syncro-icon-button-bd)"}`,
                  borderRadius: 999,
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: isMuted ? "var(--syncro-danger-text)" : "var(--syncro-icon-button-fg)",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {isMuted ? "🔇" : "🔊"}
              </button>
            )}
          </>
        )}

      />
{/* 메인 — chatOpen 시 그리드에 챗봇 컬럼 추가 */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : (chatOpen ? `1fr 360px ${CHAT_W}px` : "1fr 360px"),
        gridTemplateRows: "1fr",
        minHeight: 0,
        overflow: "hidden",
        transition: "grid-template-columns .28s ease",
      }}>

        {/* 좌측 — 지도 */}
        <div style={{ display: "flex", flexDirection: "column", padding: isMobile ? 0 : "10px 6px 10px 10px", minHeight: 0 }}>

          {activeTab === "map" && (
            <div style={{ flex: 1, position: "relative", minHeight: 0, borderRadius: isMobile ? 0 : 11, overflow: "hidden", border: isMobile ? "none" : "1px solid var(--syncro-line)", boxShadow: "var(--syncro-shadow)" }}>
              <KakaoMapView crossroads={wsData} selected={selected} onSelect={selectCr} initialCenter={initialCenter} selectedGu={selectedGu} onCctvClick={setSelectedCctv} stations={stations} onStationSelect={(id) => { console.log("지도에서 선택된 지점 ID:", id); }} complaints={complaints.filter(c => c.status !== "완료")} onComplaintClick={setSelectedComplaint} complaintCenter={complaintMapCenter} themeMode={themeMode} />

              {/* ── 구별 민원 현황 배지 — 활성 민원 1건 이상일 때만 표시 ── */}
              {selectedGu && complaints.filter(c => c.status !== "완료").length > 0 && (
                <div style={{
                  position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
                  zIndex: 20, display: "flex", alignItems: "center", gap: 10,
                  background: isLight ? "rgba(248,251,255,0.92)" : "rgba(18,14,10,0.88)", border: isLight ? "1px solid var(--syncro-line)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8, padding: "7px 14px",
                  backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                  pointerEvents: "none", whiteSpace: "nowrap",
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ffaa33", display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--syncro-ink1)", display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ color: "var(--syncro-ink0)" }}>{selectedGu.name}</b>
                    <span>현재 민원</span>
                    <b style={{ color: "#ffaa33" }}>{complaints.filter(c => c.status !== "완료").length}건</b>
                  </span>
                  <div style={{ display: "flex", gap: 10 }}>
                    {[
                      ["접수",   complaints.filter(c => c.status === "접수").length,   "#ffaa33"],
                      ["처리중", complaints.filter(c => c.status === "처리중").length, "#4ea6ff"],
                    ].filter(([, cnt]) => cnt > 0).map(([label, cnt, color]) => (
                      <span key={label} style={{ fontSize: 14, fontWeight: 700, color }}>
                        {label} {cnt}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {wsData.length === 0 && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: isLight ? "rgba(248,251,255,0.78)" : "rgba(7,12,23,0.75)", zIndex: 30, gap: 10 }}>
                  <div style={{ fontSize: 15, color: "var(--syncro-ink2)" }}>V2X 데이터 수신 대기 중...</div>
                  <div style={{ fontSize: 13, color: "var(--syncro-ink3)" }}>스프링 부트 실행 확인 (port 8080)</div>
                </div>
              )}

              {/* AI 챗봇 토글 버튼 — 우하단 오버레이 */}
              <div style={{ position: "absolute", bottom: 14, right: 14, zIndex: 20 }}>
                <button
                  onClick={() => setChatOpen(o => !o)}
                  title={chatOpen ? "AI 챗봇 닫기" : "AI 교통 어시스턴트 열기"}
                  style={{
                    width: 54, height: 54,
                    borderRadius: "50%",
                    background: chatOpen
                      ? "linear-gradient(135deg, rgba(30,41,59,0.98), rgba(59,130,246,0.94))"
                      : "linear-gradient(135deg, rgba(30,41,59,0.96), rgba(59,130,246,0.9))",
                    border: `2px solid ${chatOpen ? "rgba(147,197,253,0.72)" : "rgba(147,197,253,0.55)"}`,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: chatOpen
                      ? "0 8px 24px rgba(0,0,0,0.62), 0 0 20px rgba(96,165,250,0.34)"
                      : "0 4px 18px rgba(0,0,0,0.62), 0 0 16px rgba(96,165,250,0.28)",
                    transition: "all .2s",
                  }}
                >
                  {chatOpen
                    ? <span style={{ fontSize: 16, color: "rgba(226,232,240,0.86)" }}>✕</span>
                    : (
                      <img
                        src={CHATBOT_ICON}
                        alt="AI 상담사"
                        style={{
                          width: 42,
                          height: 42,
                          objectFit: "contain",
                          display: "block",
                          transform: "translateY(1px)",
                        }}
                      />
                    )
                  }
                </button>
              </div>

              {/* 모바일 바텀 시트 */}
              {isMobile && (
                <div
                  style={{
                    position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 60,
                    background: isLight ? "rgba(248,251,255,0.97)" : "rgba(10,10,10,0.97)",
                    borderTop: "1px solid var(--syncro-line)",
                    borderRadius: "14px 14px 0 0",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    transform: sheetOpen ? "translateY(0)" : "translateY(calc(100% - 68px))",
                    transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
                    maxHeight: "62vh",
                    display: "flex", flexDirection: "column",
                  }}
                >
                  {/* 핸들 — 스와이프/탭으로 열고 닫기 */}
                  <div
                    onTouchStart={e => { sheetTouchY.current = e.touches[0].clientY; }}
                    onTouchEnd={e => {
                      if (sheetTouchY.current == null) return;
                      const dy = sheetTouchY.current - e.changedTouches[0].clientY;
                      if (dy > 30) setSheetOpen(true);
                      else if (dy < -30) setSheetOpen(false);
                      else setSheetOpen(o => !o);
                      sheetTouchY.current = null;
                    }}
                    onClick={() => setSheetOpen(o => !o)}
                    style={{ padding: "12px 16px 10px", cursor: "pointer", flexShrink: 0, userSelect: "none" }}
                  >
                    <div style={{ width: 38, height: 4, borderRadius: 999, background: "var(--syncro-line2)", margin: "0 auto 10px" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "#4ea6ff", fontFamily: "monospace", fontWeight: 600 }}>교차로 {wsData.length}개</span>
                      <span style={{ fontSize: 12, color: "#ff5566", fontFamily: "monospace", fontWeight: 600 }}>위험 {wsData.filter(isHighRisk).length}개</span>
                      <span style={{ fontSize: 12, color: "#2ee07a", fontFamily: "monospace", fontWeight: 600 }}>평균 {avgSpeed}km/h</span>
                      <span style={{ marginLeft: "auto", color: "var(--syncro-ink2)", fontSize: 14 }}>{sheetOpen ? "▼" : "▲"}</span>
                    </div>
                  </div>
                  {/* 스크롤 콘텐츠 */}
                  <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "0 12px 24px" }}>
                    <ComplaintList
                      complaints={complaints}
                      selected={selectedComplaint}
                      onSelect={c => { setSelectedComplaint(c); setComplaintMapCenter({ ...c, _t: Date.now() }); setSheetOpen(false); }}
                      onStatusChange={fetchComplaints}
                    />
                    <div style={{ marginTop: 8 }}>
                      <BottleneckList bottlenecks={bottlenecks} selected={selected} onSelect={cr => { selectCr(cr); setSheetOpen(false); }} crossroadsCount={wsData.length} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <RiskList risks={risks} onSelect={cr => { selectCr(cr); setSheetOpen(false); }} crossroadsCount={wsData.length} />
                    </div>
                  </div>
                </div>
              )}

              {/* 좌측 하단: 신호 현황 오버레이 */}
              {selected && signalPanelOpen && (
                <div style={{ position: "absolute", bottom: isMobile ? 76 : 14, left: 14, display: "flex", flexDirection: "column", gap: 8, zIndex: 20, width: 460, maxWidth: "calc(100% - 28px)", pointerEvents: "auto" }}>
                  <div style={{ background: isLight ? "rgba(248,251,255,0.9)" : "rgba(18,16,10,0.75)", border: "1px solid var(--syncro-line)", borderRadius: 10, padding: 16, backdropFilter: "blur(8px)", boxShadow: "var(--syncro-shadow)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
                      <div style={{ fontSize: 17, color: "#4ea6ff", fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.crsrdNm}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setShowRoadView(true)} style={{ background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)", borderRadius: 6, color: "#60a5fa", fontSize: 12, cursor: "pointer", padding: "5px 11px", fontFamily: "inherit" }}>로드뷰</button>
                        <button
                          onClick={() => { setSignalPanelOpen(false); setSelected(null); }}
                          title="신호 현황 닫기"
                          style={{
                            width: 28, height: 28, borderRadius: 6,
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.14)",
                            color: "#cbd5e1", cursor: "pointer", fontSize: 16,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "inherit", lineHeight: 1,
                          }}
                        >×</button>
                      </div>
                    </div>
                    <SignalPanel cr={selected} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우측 사이드바 — 모바일에서 숨김 */}
        {!isMobile && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 10px 10px 4px", overflowY: "auto", background: "var(--syncro-bg0)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {[
              { label: "교차로 수",   value: wsData.length,                    suffix: "개",   color: "#4ea6ff" },
              { label: "위험 교차로", value: wsData.filter(isHighRisk).length,  suffix: "개",   color: "#ff5566" },
              { label: "평균 속도",   value: avgSpeed,                          suffix: "km/h", color: "#2ee07a" },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--syncro-bg1)", border: "1px solid var(--syncro-line)", borderRadius: 2, padding: "12px 10px", textAlign: "center", boxShadow: "var(--syncro-inner-shadow)" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}<span style={{ fontSize: 13 }}>{s.suffix}</span></div>
                <div style={{ fontSize: 12, color: "#7a7a7a", marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <ComplaintList
            complaints={complaints}
            selected={selectedComplaint}
            onSelect={c => { setSelectedComplaint(c); setComplaintMapCenter({ ...c, _t: Date.now() }); }}
            onStatusChange={fetchComplaints}
          />
          <BottleneckList bottlenecks={bottlenecks} selected={selected} onSelect={selectCr} crossroadsCount={wsData.length} />
          <RiskList risks={risks} onSelect={selectCr} crossroadsCount={wsData.length} />
        </div>}

        {/* 챗봇 패널 — chatOpen일 때만 그리드 컬럼에 렌더링 */}
        {chatOpen && (
          <div style={{ overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <AIChatBot
              selected={selected}
              onClose={() => setChatOpen(false)}
              isMuted={isMuted}
              themeMode={themeMode}
            />
          </div>
        )}
      </div>

      {/* 모달 */}
      {showRoadView && selected && (
        <RoadViewModal cr={selected} onClose={() => setShowRoadView(false)} />
      )}
      {selectedCctv && (
        <CctvModal cctv={selectedCctv} onClose={() => setSelectedCctv(null)} />
      )}
      {selectedComplaint && (
        <ComplaintPopup complaint={selectedComplaint} onClose={() => setSelectedComplaint(null)} />
      )}
    </div>
  );
}
