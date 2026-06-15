import { useState, useEffect, useMemo } from "react";
import { GU_LIST, calcDistKm } from "../constants/seoulGeoData";
import { V } from "../constants/theme";  // MainDashboard와 동일한 색상 체계 공유
import AppHeader from "../components/common/AppHeader";

// UTIC CCTV 스트림 인증키 (.env의 VITE_UTIC_KEY)
// 기관 계약 후 발급받은 키를 .env에 설정하면 iframe 영상 활성화
const UTIC_KEY = import.meta.env.VITE_UTIC_KEY || "";

// 스프링 REST API 주소 (.env의 VITE_API_URL)
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

// ── assignGu ─────────────────────────────────────────────────────────────────
/**
 * CCTV 좌표 → 가장 가까운 서울 자치구 이름 반환
 * Oracle DB의 CCTV3 테이블에는 구 정보가 없어서
 * CCTV의 lat/lon과 GU_LIST 25개 구 중심 좌표를 Haversine 거리로 비교해
 * 가장 가까운 구에 배정
 *
 * @param {Object} cctv - { lat, lon, ... }
 * @returns {string} 구 이름 (예: "종로구")
 */
function assignGu(cctv) {
  let best = null, bestDist = Infinity;
  GU_LIST.forEach(gu => {
    const d = calcDistKm(cctv.lat, cctv.lon, gu.lat, gu.lon);
    if (d < bestDist) { bestDist = d; best = gu.name; }
  });
  return best;
}

// ── CctvModal ─────────────────────────────────────────────────────────────────
/**
 * CCTV 영상 확대 모달
 * 리스트에서 행 클릭 시 열림
 * 배경 클릭 또는 ✕ 버튼으로 닫힘 (e.stopPropagation으로 내부 클릭 이벤트 차단)
 *
 * 영상 재생 방식:
 *   streamId 있음 → UTIC iframe (기관 계약 시 영상 활성화)
 *   streamId 없음 → "스트림 정보 없음" 안내
 *
 * iframe scale(4.0): UTIC 페이지 전체가 로드되므로
 * 불필요한 UI를 숨기고 영상 부분만 확대해서 보이도록 CSS transform 적용
 *
 * @param {Object}   cctv    - 선택된 CCTV 객체 (cctvId, cctvNm, cctvCh, streamId, lat, lon)
 * @param {Function} onClose - 모달 닫기 콜백
 */
function CctvModal({ cctv, onClose }) {
  return (
    // 배경 오버레이 — 클릭 시 닫기
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* 모달 본체 — 클릭 이벤트 버블링 차단 */}
      <div onClick={e => e.stopPropagation()} style={{ width: "90vw", maxWidth: 1180, background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 2, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* 모달 헤더: CCTV명 · ID · CH · 스트림 상태 · 닫기 버튼 */}
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${V.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: V.ink0 }}>{cctv.cctvNm}</span>
            <span style={{ fontFamily: V.mono, fontSize: 12.5, color: V.ink2 }}>ID: {cctv.cctvId}</span>
            {cctv.cctvCh && <span style={{ fontFamily: V.mono, fontSize: 12.5, color: V.ink2 }}>CH: {cctv.cctvCh}</span>}
            {/* 스트림 연결 상태 표시 */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: cctv.streamId ? V.grn : V.ink3, display: "inline-block" }} />
              <span style={{ fontSize: 12.5, color: cctv.streamId ? V.grn : V.ink3 }}>
                {cctv.streamId ? "스트림 연결됨" : "스트림 없음"}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "5px 14px", color: V.ink1, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        {/* 영상 영역 (65vh 고정 높이) */}
        <div style={{ height: "72vh", background: "#000", position: "relative", overflow: "hidden" }}>
          {cctv.streamId ? (
            // UTIC iframe: key={cctv.cctvId}로 CCTV 바뀔 때마다 iframe 완전 재마운트
            // scale(4.0) + translate로 UTIC 페이지의 영상 영역만 확대 표시
            <iframe
              key={cctv.cctvId}
              src={
                `https://www.utic.go.kr/jsp/map/openDataCctvStream.jsp`
                + `?cctvid=${encodeURIComponent(cctv.cctvId)}`
                + `&cctvName=${encodeURIComponent(encodeURIComponent(cctv.cctvNm))}`
                + `&kind=Seoul&cctvip=undefined`
                + `&cctvch=${cctv.cctvCh ?? 51}`
                + `&id=${cctv.streamId}`
                + `&cctvpasswd=undefined&cctvport=undefined`
              }
              style={{
                border: "none", display: "block", width: "100%", height: "100%",
                position: "absolute", top: "50%", left: "50%",
                transformOrigin: "center center",
                transform: "translate(-50%, 14%) scale(2.85)",
              }}
              title={cctv.cctvNm}
              allow="autoplay"
            />
          ) : (
            // streamId 없는 경우 안내 화면
            <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <div style={{ fontSize: 48, opacity: 0.08 }}>📷</div>
              <div style={{ fontSize: 12, color: V.ink3 }}>스트림 정보 없음</div>
            </div>
          )}
          {/* 좌상단: CCTV 이름 오버레이 (pointerEvents none으로 클릭 방해 안 함) */}
          {/* 우상단: LIVE 배지 (streamId 있을 때만 표시) */}
          {cctv.streamId && (
            <div style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.75)", border: `1px solid ${V.line}`, borderRadius: 2, padding: "4px 10px", pointerEvents: "none" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: V.red, display: "inline-block" }} />
              <span style={{ fontSize: 12.5, color: V.red, fontWeight: 700, fontFamily: V.mono }}>LIVE</span>
            </div>
          )}
        </div>

        {/* 하단 메타 정보: 좌표 · ID · 채널 */}
        <div style={{ padding: "11px 20px", borderTop: `1px solid ${V.line}`, display: "flex", gap: 24, fontFamily: V.mono, fontSize: 12.5, color: V.ink2 }}>
          <span>{cctv.lat?.toFixed(5)}°N, {cctv.lon?.toFixed(5)}°E</span>
          <span>ID: {cctv.cctvId}</span>
          {cctv.cctvCh && <span>CH: {cctv.cctvCh}</span>}
        </div>
      </div>
    </div>
  );
}

// ── CctvDashboard (메인 컴포넌트) ─────────────────────────────────────────────
/**
 * CCTV 관제 페이지
 *
 * 레이아웃:
 *   좌측 180px: 구 선택 사이드바 (전체 + 25개 구)
 *   우측 1fr:   CCTV 테이블 리스트 + 이름 검색
 *   모달:       행 클릭 시 영상 확대 모달
 *
 * 데이터 흐름:
 *   GET /api/cctv → 스프링 CctvController.getAll()
 *   → Oracle DB CCTV3 테이블 전체 조회 (302개)
 *   → cctvList에 저장
 *   → assignGu로 구 분류 → guGroups 생성
 *   → 구 선택 + 검색 필터 → displayList
 *
 * Props:
 *   onGoMain - "← 대시보드" 버튼 콜백
 *   onGoMap  - "🗺️ 지도 보기" 버튼 콜백
 */
export default function CctvDashboard({ onGoMain, onGoMap, onGoNews, onGoSimulation, onGoComplaints, onGoMyPage, onLogout, selectedGu, notifQueue = [], onDismissNotif, themeMode, onToggleTheme }) {
  const [time,     setTime]     = useState(new Date());
  // 스프링에서 받아온 전체 CCTV 배열 (CctvInfo DTO 배열)
  const [cctvList, setCctvList] = useState([]);
  const [loading,  setLoading]  = useState(true);
  // 현재 선택된 구 이름 (null이면 전체 보기)
  const [openGu,   setOpenGu]   = useState(null);
  // 영상 모달에 표시할 CCTV 객체 (null이면 모달 닫힘)
  const [modal,    setModal]    = useState(null);
  // 검색창 입력값 (실시간 필터링)
  const [search,   setSearch]   = useState("");

  // 헤더 시계: 1초마다 갱신
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 마운트 시 1회: 스프링에서 전체 CCTV 목록 로드
  useEffect(() => {
    fetch(`${API_BASE}/api/cctv`)
      .then(r => r.json())
      .then(data => setCctvList(data))
      .catch(() => setCctvList([]))   // 실패 시 빈 배열 (에러 화면 없이 조용히 처리)
      .finally(() => setLoading(false));
  }, []); // 빈 배열: 컴포넌트 마운트 시 단 1회만 실행

  // ── guGroups (useMemo) ────────────────────────────────────────────────────
  // cctvList가 변경될 때만 재계산 (302개 순회는 비싸지 않지만 성능 최적화 목적)
  //
  // 처리 과정:
  // 1. cctvList 전체를 순회하며 assignGu로 구 분류
  //    → { "종로구": [cctv1, cctv2], "중구": [...], ... } 맵 생성
  // 2. GU_LIST 순서로 정렬 (한국 행정구역 순서 유지, map 객체는 삽입 순서 불규칙)
  // 3. CCTV가 없는 구는 제외
  // 결과: [{ name: "종로구", cctvs: [cctv1, cctv2] }, ...]
  const guGroups = useMemo(() => {
    const map = {};
    cctvList.forEach(cctv => {
      const gu = assignGu(cctv);
      if (!map[gu]) map[gu] = [];
      map[gu].push(cctv);
    });
    return GU_LIST.filter(g => map[g.name]).map(g => ({ name: g.name, cctvs: map[g.name] }));
  }, [cctvList]);

  // ── displayList (useMemo) ─────────────────────────────────────────────────
  // 구 선택 + 검색어 조합으로 테이블에 표시할 최종 목록 결정
  // openGu === null → 전체 cctvList
  // openGu 있음    → 해당 구 cctvs만
  // search 있음    → cctvNm에 검색어 포함 여부로 추가 필터
  const displayList = useMemo(() => {
    let list = openGu
      ? (guGroups.find(g => g.name === openGu)?.cctvs ?? [])
      : cctvList;
    if (search.trim()) {
      list = list.filter(c => c.cctvNm?.includes(search.trim()));
    }
    return list;
  }, [openGu, guGroups, cctvList, search]);

  return (
    <div style={{ fontFamily: V.sans, background: V.bg0, color: V.ink0, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* 공통 헤더 */}
      <AppHeader
        activePage="cctv"
        selectedGu={selectedGu}
        statusText={!loading ? `총 ${cctvList.length}개 CCTV` : "CCTV 수집 중"}
        statusLive={!loading && cctvList.length > 0}
        onGoMain={onGoMain}
        onGoMap={onGoMap}
        onGoNews={onGoNews}
        onGoCctv={() => {}}
        onGoSimulation={onGoSimulation}
        onGoComplaints={onGoComplaints}
        onGoMyPage={onGoMyPage}
        onLogout={onLogout}
        notifQueue={notifQueue}
        onDismissNotif={onDismissNotif}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
      />
{/* ── 메인 (2컬럼) ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ── 좌측: 구 선택 사이드바 (180px 고정) ── */}
        <div style={{ width: 210, borderRight: `1px solid ${V.line}`, overflowY: "auto", flexShrink: 0 }}>
          <div style={{ padding: "12px 16px 8px", fontSize: 12, color: V.ink3, fontWeight: 600, letterSpacing: 1, fontFamily: V.mono }}>구 선택</div>

          {/* 전체 보기 버튼 */}
          {/* openGu === null이면 파란 좌측 테두리 + 진한 배경으로 선택 표시 */}
          <div
            onClick={() => setOpenGu(null)}
            style={{ padding: "9px 16px", cursor: "pointer", background: !openGu ? "var(--syncro-selected-bg)" : "transparent", borderLeft: !openGu ? `2px solid ${V.blu}` : "2px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onMouseEnter={e => { if (openGu) e.currentTarget.style.background = "var(--syncro-selected-bg)"; }}
            onMouseLeave={e => { if (openGu) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 14, fontWeight: !openGu ? 700 : 400, color: !openGu ? V.ink0 : V.ink1 }}>전체 보기</span>
            <span style={{ fontFamily: V.mono, fontSize: 12.5, color: V.blu }}>{cctvList.length}</span>
          </div>

          {/* 구별 목록 (GU_LIST 순서대로 정렬, CCTV 없는 구 제외) */}
          {guGroups.map(gu => (
            <div key={gu.name}
              onClick={() => setOpenGu(gu.name)}
              style={{ padding: "9px 16px", cursor: "pointer", background: openGu === gu.name ? "var(--syncro-selected-bg)" : "transparent", borderLeft: openGu === gu.name ? `2px solid ${V.blu}` : "2px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              onMouseEnter={e => { if (openGu !== gu.name) e.currentTarget.style.background = "var(--syncro-selected-bg)"; }}
              onMouseLeave={e => { if (openGu !== gu.name) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 14, fontWeight: openGu === gu.name ? 700 : 400, color: openGu === gu.name ? V.ink0 : V.ink1 }}>{gu.name}</span>
              {/* 해당 구 CCTV 수 */}
              <span style={{ fontFamily: V.mono, fontSize: 12.5, color: V.blu }}>{gu.cctvs.length}</span>
            </div>
          ))}
        </div>

        {/* ── 우측: CCTV 리스트 ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

          {/* 리스트 상단: 현재 구/전체 표시 + 검색창 */}
          <div style={{ padding: "12px 20px", borderBottom: `1px solid ${V.line}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: V.ink0 }}>
              {openGu ?? "전체"}{" "}
              <span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink2, fontWeight: 400 }}>{displayList.length}개</span>
            </span>
            {/* 실시간 검색: onChange마다 search 갱신 → displayList 즉시 재계산 */}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="CCTV 이름 검색..."
              style={{ marginLeft: "auto", background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "8px 13px", color: V.ink0, fontSize: 13, outline: "none", fontFamily: "inherit", width: 220 }}
            />
          </div>

          {/* 테이블 컬럼 헤더 (5컬럼 grid) */}
          {/* gridTemplateColumns: CCTV이름(2fr) ID(1fr) 채널(1fr) 좌표(1fr) 상태(90px) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 90px", padding: "8px 20px", borderBottom: `1px solid ${V.line}`, flexShrink: 0 }}>
            {["CCTV 이름", "ID", "채널", "좌표", "상태"].map(h => (
              <div key={h} style={{ fontSize: 12.5, color: V.ink3, fontWeight: 700, fontFamily: V.mono, letterSpacing: 0.5 }}>{h}</div>
            ))}
          </div>

          {/* 테이블 바디 (스크롤 영역) */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* 로딩 중 스피너 */}
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 220, gap: 10, color: V.ink2 }}>
                <div style={{ width: 18, height: 18, border: `2px solid ${V.line}`, borderTop: `2px solid ${V.blu}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                불러오는 중...
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            ) : displayList.length === 0 ? (
              // 검색 결과 없음
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 220, color: V.ink3, fontSize: 14 }}>
                검색 결과 없음
              </div>
            ) : displayList.map((cctv, i) => (
              // 각 CCTV 행: 클릭 시 모달 열기
              // 짝수/홀수 행 배경 미세하게 다르게 (가독성)
              <div key={cctv.cctvId}
                onClick={() => setModal(cctv)}
                style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 90px",
                  padding: "12px 20px",
                  borderBottom: `1px solid ${V.line}`,
                  cursor: "pointer",
                  background: i % 2 === 0 ? "transparent" : "rgba(59,130,246,0.04)",
                  transition: "background .1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(78,166,255,0.06)"}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(59,130,246,0.04)"}
              >
                {/* CCTV 이름 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, color: V.ink0, fontWeight: 500 }}>{cctv.cctvNm}</span>
                </div>
                {/* ID (L010xxx 형식) */}
                <div style={{ fontSize: 13, color: V.ink2, fontFamily: V.sans, alignSelf: "center" }}>{cctv.cctvId}</div>
                {/* 채널 번호 (없으면 —) */}
                <div style={{ fontSize: 13, color: V.ink2, fontFamily: V.sans, alignSelf: "center" }}>
                  {cctv.cctvCh ? `CH ${cctv.cctvCh}` : "—"}
                </div>
                {/* 좌표 (소수점 4자리) */}
                <div style={{ fontSize: 12.5, color: V.ink3, fontFamily: V.sans, alignSelf: "center" }}>
                  {cctv.lat?.toFixed(4)}, {cctv.lon?.toFixed(4)}
                </div>
                {/* 상태: streamId 있으면 초록 LIVE / 없으면 회색 NO SRC */}
                {/* boxShadow로 초록 glow 효과 (LIVE 강조) */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, alignSelf: "center" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: cctv.streamId ? V.grn : V.ink3, display: "inline-block", flexShrink: 0, boxShadow: cctv.streamId ? `0 0 4px ${V.grn}` : "none" }} />
                  <span style={{ fontSize: 13, color: cctv.streamId ? V.grn : V.ink3, fontFamily: V.sans, fontWeight: 600 }}>
                    {cctv.streamId ? "LIVE" : "NO SRC"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 영상 확대 모달 (modal 있을 때만 렌더) ── */}
      {modal && <CctvModal cctv={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
