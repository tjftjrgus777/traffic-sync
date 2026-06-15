import { useState, useEffect, useRef } from "react";

const API        = (import.meta.env.VITE_API_URL       || "http://localhost:8080").replace(/\/+$/, "");
const CIVIL_API  = (import.meta.env.VITE_CIVIL_API_URL || "http://localhost:8002").replace(/\/+$/, "");
const KAKAO_KEY  = import.meta.env.VITE_KAKAO_APP_KEY;

const DEPT_MAP = {
  "도로 파손/균열":   "도로과",
  "노면 침수/결빙":   "도로과",
  "횡단보도 파손":    "도로과",
  "신호등 오작동":    "교통과",
  "교통표지판 훼손":  "교통과",
  "공사구간 미표시":  "교통과",
  "불법 주정차":      "주차과",
  "가로등 불량/소등": "시설과",
  "보행자 위험구간":  "시설과",
  "도로 청결 불량":   "환경미화과",
  "동물 사체":        "환경미화과",
  "이륜차 불법 운행": "경찰서",
  "과속/난폭운전":    "경찰서",
  "소음/진동":        "환경과",
  "기타":             "민원과",
};

export const CIVIL_CATEGORIES = [
  "도로 파손/균열",
  "신호등 오작동",
  "불법 주정차",
  "노면 침수/결빙",
  "가로등 불량/소등",
  "교통표지판 훼손",
  "공사구간 미표시",
  "보행자 위험구간",
  "이륜차 불법 운행",
  "과속/난폭운전",
  "도로 청결 불량",
  "횡단보도 파손",
  "소음/진동",
  "기타",
];

const V = {
  bg0: "#000", bg1: "#0a0a0a", line: "#1a1a1a",
  ink0: "#e7ecf5", ink1: "#aab4c8", ink2: "#7a7a7a", ink3: "#3a3a3a",
  grn: "#2ee07a", red: "#ff5566", org: "#ffaa33", blu: "#4ea6ff",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR',system-ui,sans-serif",
};

const inpStyle = {
  width: "100%", padding: "0 14px", background: V.bg0, border: `1px solid ${V.line}`,
  borderRadius: 2, color: V.ink0, fontSize: 14, fontFamily: V.sans, outline: "none", boxSizing: "border-box",
};

export default function CivilDashboard({ civilUser, onLogout }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const mapRef    = useRef(null);
  const mapObj    = useRef(null);
  const markerRef = useRef(null);
  const geocRef   = useRef(null);

  const [ready, setReady]             = useState(false);
  const [selectedLoc, setSelectedLoc] = useState(null);   // { lat, lng, address }
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formOpen, setFormOpen]       = useState(false);
  const [form, setForm]               = useState({ title: "", category: CIVIL_CATEGORIES[0], content: "" });
  const [photos, setPhotos]           = useState([]);
  const [previews, setPreviews]       = useState([]);
  const [submitting, setSubmitting]   = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [department, setDepartment]   = useState(null);  // AI가 추천한 담당과
  const [aiReason, setAiReason]       = useState("");
  const [submitOk, setSubmitOk]       = useState(false);
  const [err, setErr]                 = useState("");
  const [searchQ, setSearchQ]         = useState("");

  // ── Kakao SDK 로드 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.kakao?.maps) { setReady(true); return; }
    if (document.querySelector("script[data-kakao]")) {
      const id = setInterval(() => { if (window.kakao?.maps) { clearInterval(id); setReady(true); } }, 100);
      return () => clearInterval(id);
    }
    const s = document.createElement("script");
    s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=clusterer,services&autoload=false`;
    s.setAttribute("data-kakao", "1");
    s.onload = () => window.kakao.maps.load(() => setReady(true));
    document.head.appendChild(s);
  }, []);

  // ── 지도 초기화 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const kakao = window.kakao;

    const map = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(37.5665, 126.9780),
      level: 7,
    });
    mapRef.current.style.filter = "invert(90%) hue-rotate(180deg) brightness(0.85) saturate(0.9)";
    mapObj.current = map;
    geocRef.current = new kakao.maps.services.Geocoder();

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        map.setCenter(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
        map.setLevel(5);
      });
    }

    kakao.maps.event.addListener(map, "click", mouseEvent => {
      const latlng = mouseEvent.latLng;
      const lat = latlng.getLat();
      const lng = latlng.getLng();

      if (markerRef.current) markerRef.current.setMap(null);
      const marker = new kakao.maps.Marker({ position: latlng });
      marker.setMap(map);
      markerRef.current = marker;

      geocRef.current.coord2Address(lng, lat, (result, status) => {
        const address = status === kakao.maps.services.Status.OK
          ? (result[0].road_address?.address_name || result[0].address.address_name)
          : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setSelectedLoc({ lat, lng, address });
        setFormOpen(false);
        setConfirmOpen(true);
      });
    });
  }, [ready]);

  // ── 검색 마커 ref ───────────────────────────────────────────────────────────
  const searchMarkerRef    = useRef(null);
  const searchOverlayRef   = useRef(null);
  const [searchNoResult, setSearchNoResult] = useState(false);

  // ── 검색 ────────────────────────────────────────────────────────────────────
  const handleSearch = () => {
    if (!searchQ.trim() || !mapObj.current) return;
    setSearchNoResult(false);

    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(searchQ, (data, status) => {
      // 기존 마커/오버레이 제거
      if (searchMarkerRef.current)  { searchMarkerRef.current.setMap(null);  searchMarkerRef.current = null; }
      if (searchOverlayRef.current) { searchOverlayRef.current.setMap(null); searchOverlayRef.current = null; }

      if (status !== window.kakao.maps.services.Status.OK || !data.length) {
        setSearchNoResult(true);
        setTimeout(() => setSearchNoResult(false), 3000);
        return;
      }

      const place = data[0];
      const latlng = new window.kakao.maps.LatLng(place.y, place.x);

      // 마커
      const marker = new window.kakao.maps.Marker({ position: latlng });
      marker.setMap(mapObj.current);
      searchMarkerRef.current = marker;

      // 마커 위 이름 라벨 (X 버튼 포함)
      const overlayId = `search-overlay-${Date.now()}`;
      const content = `<div id="${overlayId}" style="
        display:flex; align-items:center; gap:6px;
        background: rgba(0,0,0,0.92); color: #e7ecf5;
        padding: 5px 10px 5px 12px; border-radius: 6px;
        font-size: 12px; font-weight: 700;
        border: 1px solid #2a2a2a;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.6);
      ">
        ${place.place_name}
        <span onclick="document.getElementById('${overlayId}').parentElement.parentElement.style.display='none'" style="cursor:pointer;color:#7a7a7a;font-size:13px;line-height:1;padding-left:2px;">✕</span>
      </div>`;
      const overlay = new window.kakao.maps.CustomOverlay({
        position: latlng,
        content,
        yAnchor: 2.1,
      });
      overlay.setMap(mapObj.current);
      searchOverlayRef.current = overlay;

      mapObj.current.setCenter(latlng);
      mapObj.current.setLevel(4);
    });
  };

  // ── 현재 위치 → 마커 + 민원 신청 ──────────────────────────────────────────
  const [locating, setLocating] = useState(false);

  const goCurrentLocation = () => {
    if (!mapObj.current || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const latlng = new window.kakao.maps.LatLng(lat, lng);
      mapObj.current.setCenter(latlng);
      mapObj.current.setLevel(4);

      if (markerRef.current) markerRef.current.setMap(null);
      const marker = new window.kakao.maps.Marker({ position: latlng });
      marker.setMap(mapObj.current);
      markerRef.current = marker;

      geocRef.current.coord2Address(lng, lat, (result, status) => {
        const address = status === window.kakao.maps.services.Status.OK
          ? (result[0].road_address?.address_name || result[0].address.address_name)
          : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setSelectedLoc({ lat, lng, address });
        setFormOpen(false);
        setConfirmOpen(true);
        setLocating(false);
      });
    }, (err) => {
      setLocating(false);
      alert("위치를 가져올 수 없습니다.\n지도를 직접 클릭해서 위치를 선택해 주세요.");
    });
  };

  // ── HEIC → JPEG 변환 헬퍼 ─────────────────────────────────────────────────
  // ── 사진 첨부 + AI 자동 분류 ──────────────────────────────────────────────
  const handlePhoto = async e => {
    const raw = Array.from(e.target.files).slice(0, 3 - photos.length);
    if (!raw.length) return;
    e.target.value = "";

    const files = raw;

    const newPhotos = [...photos, ...files].slice(0, 3);
    setPhotos(newPhotos);
    files.forEach(file => {
      const name = file.name.toLowerCase();
      const isHeic = file.type === "image/heic" || file.type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif");
      if (isHeic) {
        // HEIC: objectURL로 시도 (Safari는 됨, Chrome은 onError에서 null 처리)
        setPreviews(prev => [...prev, { url: URL.createObjectURL(file), isHeic: true }].slice(0, 3));
      } else {
        const reader = new FileReader();
        reader.onload = ev => setPreviews(prev => [...prev, { url: ev.target.result, isHeic: false }].slice(0, 3));
        reader.readAsDataURL(file);
      }
    });

    // 첫 번째 사진 첨부 시 AI 분류 자동 실행
    if (photos.length === 0 && files[0]) {
      setClassifying(true);
      setDepartment(null);
      setAiReason("");
      try {
        const fd = new FormData();
        fd.append("image", files[0]);
        fd.append("title", form.title);
        const res = await fetch(`${CIVIL_API}/api/civil/classify`, { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) {
          setForm(f => ({ ...f, category: data.category }));
          setDepartment(data.department);
          setAiReason(data.reason);
          if (data.convertedImage) {
            setPreviews(prev => {
              const next = [...prev];
              if (next[0]?.isHeic) URL.revokeObjectURL(next[0].url);
              next[0] = { url: data.convertedImage, isHeic: false };
              return next;
            });
          }
        }
      } catch {
        // AI 분류 실패 시 조용히 무시 (수동 선택 가능)
      } finally {
        setClassifying(false);
      }
    }
  };

  const removePhoto = i => {
    setPreviews(p => {
      if (p[i]?.isHeic) URL.revokeObjectURL(p[i].url);
      return p.filter((_, j) => j !== i);
    });
    setPhotos(p => p.filter((_, j) => j !== i));
  };

  // ── 민원 제출 ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.title.trim()) { setErr("제목을 입력하세요."); return; }
    if (!form.content.trim()) { setErr("민원 내용을 입력하세요."); return; }
    setSubmitting(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("userId",   civilUser.userId);
      fd.append("userName", civilUser.name);
      fd.append("title",    form.title);
      fd.append("category", form.category);
      fd.append("content",  form.content);
      fd.append("lat",      selectedLoc.lat);
      fd.append("lng",      selectedLoc.lng);
      fd.append("address",    selectedLoc.address);
      if (department) fd.append("department", department);
      if (aiReason)   fd.append("aiReason",   aiReason);
      photos.forEach(p => fd.append("photos", p));

      const res = await fetch(`${API}/api/complaints`, { method: "POST", body: fd });
      if (res.ok) {
        setSubmitOk(true);
        setFormOpen(false);
        setForm({ title: "", category: CIVIL_CATEGORIES[0], content: "" });
        setPhotos([]); setPreviews([]);
        setDepartment(null); setAiReason("");
        setTimeout(() => setSubmitOk(false), 5000);
      } else {
        const d = await res.json().catch(() => ({}));
        setErr(d.message || "민원 접수에 실패했습니다.");
      }
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setSubmitting(false); }
  };

  const cancelSelection = () => {
    setConfirmOpen(false);
    if (markerRef.current) markerRef.current.setMap(null);
    setSelectedLoc(null);
  };

  // ── 렌더링 ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: V.sans, background: V.bg0, color: V.ink0, height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── 헤더 ── */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", background: V.bg1, borderBottom: `1px solid ${V.line}`, flexShrink: 0 }}>
          {/* 모바일 1행: 타이틀 + 로그아웃 */}
          <div style={{ height: 44, display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
            <span style={{ width: 7, height: 7, background: V.org, borderRadius: "50%", display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Syncro 민원 신청</span>
            {submitOk && <span style={{ fontFamily: V.mono, fontSize: 10, color: V.grn }}>✓ 접수완료</span>}
            <button onClick={onLogout} style={{ height: 30, padding: "0 12px", background: "transparent", border: "1px solid #3a1820", borderRadius: 2, color: V.red, fontSize: 12, cursor: "pointer", fontFamily: V.sans, flexShrink: 0 }}>로그아웃</button>
          </div>
          {/* 모바일 2행: 검색 */}
          <div style={{ display: "flex", gap: 6, padding: "0 14px 10px" }}>
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="위치 검색"
              style={{ flex: 1, height: 34, padding: "0 12px", background: "rgba(255,255,255,.05)", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink0, fontSize: 13, fontFamily: V.sans, outline: "none" }}
            />
            <button onClick={handleSearch} style={{ height: 34, padding: "0 16px", background: V.org, border: "none", borderRadius: 2, color: "#000", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>검색</button>
          </div>
        </div>
      ) : (
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", background: V.bg1, borderBottom: `1px solid ${V.line}`, flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, background: V.org, borderRadius: "50%", display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>Syncro 민원 신청</span>
          <div style={{ width: 1, height: 18, background: V.line }} />
          <span style={{ fontFamily: V.mono, fontSize: 12, color: V.ink2, whiteSpace: "nowrap" }}>{civilUser.name} 님</span>
          <div style={{ display: "flex", gap: 6, marginLeft: 8, flex: 1, maxWidth: 360 }}>
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder="위치 검색 (Enter)"
              style={{ flex: 1, height: 34, padding: "0 12px", background: "rgba(255,255,255,.05)", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink0, fontSize: 13, fontFamily: V.sans, outline: "none" }} />
            <button onClick={handleSearch} style={{ height: 34, padding: "0 14px", background: V.org, border: "none", borderRadius: 2, color: "#000", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>검색</button>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {submitOk && <span style={{ fontFamily: V.mono, fontSize: 11, color: V.grn, padding: "4px 8px", border: "1px solid #1a3a24", background: "#0c1a12", borderRadius: 2 }}>✓ 민원이 접수되었습니다</span>}
            <button onClick={onLogout} style={{ height: 32, padding: "0 14px", background: "transparent", border: "1px solid #3a1820", borderRadius: 2, color: V.red, fontSize: 13, cursor: "pointer", fontFamily: V.sans }}>로그아웃</button>
          </div>
        </div>
      )}


      {/* ── 지도 ── */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%" }}>
          {!ready && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: V.bg0, color: V.ink2, fontSize: 13, fontFamily: V.mono }}>
              지도 로딩 중...
            </div>
          )}
        </div>

        {/* 검색 결과 없음 토스트 */}
        {searchNoResult && (
          <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 20, background: "rgba(8,8,8,0.95)", border: `1px solid ${V.line}`, borderRadius: 6, padding: "8px 16px", fontFamily: V.mono, fontSize: 12, color: V.ink2, whiteSpace: "nowrap", pointerEvents: "none" }}>
            검색 결과가 없습니다
          </div>
        )}

        {/* 현재 위치로 민원 신청 버튼 — 모바일에서 숨김 */}
        {!isMobile && (
          <button onClick={goCurrentLocation} disabled={locating} title="현재 위치에 민원 신청"
            style={{ position: "absolute", bottom: 24, right: 16, zIndex: 10, height: 54, padding: "0 20px", background: locating ? "#1a1a1a" : V.org, border: "none", borderRadius: 6, color: locating ? V.ink2 : "#000", fontSize: 14, fontWeight: 700, cursor: locating ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 16px rgba(0,0,0,.6)", fontFamily: V.sans, whiteSpace: "nowrap" }}>
            {locating ? "위치 확인 중..." : "현재 위치로 신청"}
          </button>
        )}

        {/* 범례 — 모바일에서 숨김 */}
        {!isMobile && (
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, background: "rgba(0,0,0,0.88)", border: `1px solid ${V.line}`, borderRadius: 2, padding: "10px 14px" }}>
            <div style={{ fontFamily: V.mono, fontSize: 11, color: V.ink0, fontWeight: 700, marginBottom: 4 }}>민원 신청 방법</div>
            <div style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2 }}>① 지도 클릭 → ② 위치 확인 → ③ 내용 입력</div>
          </div>
        )}

        {/* ── 위치 확인 — 마커 위 플로팅 카드 ── */}
        {confirmOpen && selectedLoc && (
          <div style={{
            position: "absolute", bottom: 80, left: "50%", transform: "translateX(-50%)",
            zIndex: 20, width: 340, maxWidth: "calc(100vw - 32px)",
            background: "#0a0a0a", border: `1px solid ${V.line}`,
            borderRadius: 4, overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
          }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${V.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: V.mono, fontSize: 10, color: V.ink2, letterSpacing: ".5px", marginBottom: 4 }}>LOCATION SELECTED</div>
                <div style={{ fontFamily: V.sans, fontSize: 13, color: V.ink0, fontWeight: 600 }}>{selectedLoc.address}</div>
              </div>
              <button onClick={cancelSelection} style={{ background: "transparent", border: "none", color: V.ink2, fontSize: 14, cursor: "pointer", flexShrink: 0, padding: "2px 4px" }}>✕</button>
            </div>
            <div style={{ display: "flex" }}>
              <button onClick={() => { setConfirmOpen(false); setFormOpen(true); }}
                style={{ flex: 2, height: 44, background: V.org, border: "none", color: "#000", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: V.sans, letterSpacing: ".3px" }}>
                민원 신청하기
              </button>
              <button onClick={cancelSelection}
                style={{ flex: 1, height: 44, background: "transparent", borderLeft: `1px solid ${V.line}`, border: "none", borderLeft: `1px solid ${V.line}`, color: V.ink2, fontSize: 13, cursor: "pointer", fontFamily: V.sans }}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 민원 입력 패널 (우측 슬라이드) ── */}
      {formOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={() => setFormOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
          <div style={{ position: "relative", width: isMobile ? "100%" : 480, background: V.bg1, borderLeft: `1px solid ${V.line}`, display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", boxShadow: "-8px 0 32px rgba(0,0,0,0.7)" }}>

            {/* 패널 헤더 */}
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${V.line}`, background: "#080808", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: V.ink0 }}>민원 내용 입력</span>
              <div style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 11, color: V.ink2, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                📍 {selectedLoc?.address}
              </div>
              <button onClick={() => setFormOpen(false)}
                style={{ width: 28, height: 28, background: "transparent", border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink2, cursor: "pointer", fontSize: 15, flexShrink: 0 }}>✕</button>
            </div>

            <div style={{ flex: 1, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

              {/* 제목 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, letterSpacing: ".4px" }}>제목 <span style={{ color: V.red }}>*</span></label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="민원 제목을 입력하세요"
                  style={{ ...inpStyle, height: 42 }} />
              </div>

              {/* 민원 분류 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, letterSpacing: ".4px" }}>민원 분류 <span style={{ color: V.red }}>*</span></label>
                <select value={form.category} onChange={e => {
                  setForm(f => ({ ...f, category: e.target.value }));
                  setDepartment(DEPT_MAP[e.target.value] || "민원과");
                  setAiReason("");
                }} style={{ ...inpStyle, height: 42, cursor: "pointer" }}>
                  {CIVIL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* AI 분류 중 - 타이핑 애니메이션 */}
                {classifying && (
                  <div style={{ padding: "12px 14px", background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 6, marginTop: 2 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink1 }}>이미지 분석 중</span>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {[0, 1, 2].map(i => (
                          <span key={i} style={{
                            width: 5, height: 5, borderRadius: "50%", background: V.ink2,
                            animation: "aiDot 1.2s ease-in-out infinite",
                            animationDelay: `${i * 0.2}s`,
                            display: "inline-block",
                          }} />
                        ))}
                        <style>{`@keyframes aiDot { 0%,80%,100%{opacity:.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1.1)} }`}</style>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI 분류 결과 */}
                {!classifying && department && aiReason && (
                  <div style={{ padding: "14px", background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 6, marginTop: 2, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1, padding: "8px 12px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: ".4px" }}>분류</span>
                        <span style={{ fontFamily: V.sans, fontSize: 13, color: V.ink0, fontWeight: 700 }}>{form.category}</span>
                      </div>
                      <div style={{ flex: 1, padding: "8px 12px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: ".4px" }}>담당과</span>
                        <span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink0, fontWeight: 700 }}>{department}</span>
                      </div>
                    </div>
                    <div style={{ fontFamily: V.sans, fontSize: 12, color: V.ink1, lineHeight: 1.7, padding: "8px 10px", background: V.bg0, border: `1px solid ${V.line}`, borderRadius: 4 }}>
                      · {aiReason}
                    </div>
                    <span style={{ fontFamily: V.mono, fontSize: 10, color: V.ink2 }}>분류가 맞지 않으면 위 드롭다운에서 직접 변경하세요.</span>
                  </div>
                )}

                {/* 수동 선택 시 담당과만 표시 */}
                {!classifying && !aiReason && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 4 }}>
                    <span style={{ fontFamily: V.mono, fontSize: 10, color: V.ink2 }}>담당과</span>
                    <span style={{ fontFamily: V.mono, fontSize: 12, color: V.ink0, fontWeight: 700 }}>{DEPT_MAP[form.category] || "민원과"}</span>
                  </div>
                )}
              </div>

              {/* 민원 내용 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, letterSpacing: ".4px" }}>민원 내용 <span style={{ color: V.red }}>*</span></label>
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="상황을 자세히 설명해주세요..."
                  rows={5}
                  style={{ ...inpStyle, height: "auto", padding: "12px 14px", resize: "vertical", lineHeight: 1.6 }} />
              </div>

              {/* 사진 첨부 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, letterSpacing: ".4px" }}>
                    사진 첨부 <span style={{ fontWeight: 400 }}>(최대 3장)</span>
                  </label>
                  {photos.length === 0 && (
                    <span style={{ fontFamily: V.mono, fontSize: 10, color: V.ink2 }}>사진 첨부 시 AI가 자동 분류합니다</span>
                  )}
                </div>

                {/* 사진이 없을 때 드래그앤드롭 스타일 업로드 영역 */}
                {photos.length === 0 ? (
                  <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "24px 16px", border: `1px dashed ${V.line}`, borderRadius: 6, cursor: "pointer", background: "#0d0d0d", transition: "all .2s" }}
                    onMouseEnter={e => { e.currentTarget.style.border = "1px dashed #3a3a3a"; e.currentTarget.style.background = "#111"; }}
                    onMouseLeave={e => { e.currentTarget.style.border = `1px dashed ${V.line}`; e.currentTarget.style.background = "#0d0d0d"; }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: V.sans, fontSize: 13, color: V.ink1, fontWeight: 600 }}>사진을 클릭해서 첨부하세요</div>
                      <div style={{ fontFamily: V.mono, fontSize: 10, color: V.ink2, marginTop: 3 }}>첫 번째 사진으로 AI가 민원 유형을 자동 분류합니다</div>
                    </div>
                    <input type="file" accept="image/*" multiple onChange={handlePhoto} style={{ display: "none" }} />
                  </label>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {previews.map((preview, i) => (
                      <div key={i} style={{ position: "relative", width: 88, height: 88 }}>
                        {preview.isHeic ? (
                          // HEIC: objectURL 시도, 실패 시 플레이스홀더
                          <img
                            src={preview.url}
                            alt=""
                            style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 6, border: `1px solid ${V.line}` }}
                            onError={ev => {
                              ev.currentTarget.style.display = "none";
                              ev.currentTarget.nextSibling.style.display = "flex";
                            }}
                          />
                        ) : (
                          <img src={preview.url} alt="" style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 6, border: `1px solid ${V.line}` }} />
                        )}
                        {preview.isHeic && (
                          <div style={{ display: "none", width: 88, height: 88, borderRadius: 6, border: `1px solid ${V.line}`, background: "#0d0d0d", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            <span style={{ fontFamily: V.mono, fontSize: 18, color: V.ink2 }}>⬜</span>
                            <span style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2 }}>HEIC</span>
                          </div>
                        )}
                        {i === 0 && (
                          <span style={{ position: "absolute", bottom: 4, left: 4, fontFamily: V.mono, fontSize: 9, color: V.ink2, background: "rgba(0,0,0,0.8)", border: `1px solid ${V.line}`, borderRadius: 3, padding: "1px 5px" }}>AI 분석</span>
                        )}
                        <button onClick={() => removePhoto(i)}
                          style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, background: V.red, border: "none", borderRadius: "50%", color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                          ✕
                        </button>
                      </div>
                    ))}
                    {photos.length < 3 && (
                      <label style={{ width: 88, height: 88, border: `1px dashed ${V.line}`, borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", color: V.ink2, gap: 4 }}>
                        <span style={{ fontSize: 20 }}>+</span>
                        <span style={{ fontFamily: V.mono, fontSize: 9 }}>추가</span>
                        <input type="file" accept="image/*" multiple onChange={handlePhoto} style={{ display: "none" }} />
                      </label>
                    )}
                  </div>
                )}
              </div>

              {err && (
                <div style={{ fontFamily: V.mono, fontSize: 12, color: V.red, padding: "8px 12px", background: "#1a0a10", border: "1px solid #3a1820", borderRadius: 2 }}>{err}</div>
              )}
            </div>

            {/* 제출 버튼 */}
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${V.line}`, flexShrink: 0, background: "#060606" }}>
              <button onClick={handleSubmit} disabled={submitting}
                style={{ width: "100%", height: 48, background: submitting ? V.ink3 : V.org, border: "none", borderRadius: 2, color: "#000", fontSize: 15, fontWeight: 700, cursor: submitting ? "wait" : "pointer", fontFamily: V.sans, letterSpacing: ".3px" }}>
                {submitting ? "접수 중..." : "민원 접수하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
