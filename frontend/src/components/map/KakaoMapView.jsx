import { useState, useEffect, useRef, useMemo } from "react";
import { domColor } from "../../utils/signalUtils";
import { calcDistKm } from "../../constants/seoulGeoData";

// 지도 기본 중심 좌표 (잠실역) — initialCenter prop 없을 때 사용
const DEFAULT_LAT = 37.5133;
const DEFAULT_LON = 127.1002;

// 스프링 REST API 주소 — CCTV 목록 조회용
const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const CLUSTER_LEVEL = 5; // 카카오맵 level 값이 클수록 줌아웃 상태

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function markerLat(item) {
  return toNum(item?.lat ?? item?.latitude);
}

function markerLon(item) {
  return toNum(item?.lon ?? item?.lng ?? item?.longitude);
}

function isWithinSelectedGu(item, selectedGu, radiusKm = 2.5) {
  if (!selectedGu) return true;
  const lat = markerLat(item);
  const lon = markerLon(item);
  if (lat == null || lon == null) return false;
  return calcDistKm(lat, lon, selectedGu.lat, selectedGu.lon) <= radiusKm;
}


/**
 * KakaoMapView 컴포넌트
 *
 * 카카오맵 SDK를 동적으로 로드하고 교차로 신호등 마커 + CCTV 마커를 표시.
 * MapDashboard 좌측 전체를 차지하는 핵심 지도 뷰.
 *
 * @param {Array}    crossroads    - WebSocket 교차로 신호 데이터 배열 (useWebSocket에서 가공됨)
 * @param {Object}   selected      - 현재 선택된 교차로 (마커 강조 + panTo)
 * @param {Function} onSelect      - 마커 클릭 시 교차로 객체 전달 콜백
 * @param {Object}   initialCenter - 최초 지도 중심 좌표 { lat, lon } (구 클릭 시 전달)
 * @param {Function} onCctvClick   - CCTV 마커 클릭 시 CCTV 객체 전달 콜백 → CctvModal 열기
 */
export default function KakaoMapView({ crossroads, selected, onSelect, initialCenter, selectedGu, onCctvClick, stations = [], onStationSelect, complaints = [], onComplaintClick, complaintCenter }) {

  // ── Ref: 재렌더링 없이 값 유지 ──────────────────────────────────────────────
  const mapRef            = useRef(null); // 카카오맵이 실제로 렌더링될 DOM div 요소
  const mapObj            = useRef(null); // kakao.maps.Map 인스턴스 (지도 객체)
  const complaintOverlays = useRef([]);   // 민원 마커 오버레이 배열
  const overlays     = useRef({});   // 교차로 오버레이 맵 { crsrdId → CustomOverlay }
  const cctvOverlays = useRef([]);   // CCTV CustomOverlay 배열 (toggle 시 일괄 제거용)
  const cctvClusterer = useRef(null);  // CCTV 줌아웃 클러스터
  const trafficClusterer = useRef(null); // 교통량 지점 줌아웃 클러스터
  const signalClusterer = useRef(null); // 신호등 마커 줌아웃 클러스터
  const analyzeOverlays = useRef({ lines: [], pings: [], timer: null }); // 멀티에이전트 분석 오버레이

  // ── State: 바뀌면 리렌더 트리거 ────────────────────────────────────────────
  const [ready,    setReady]    = useState(false); // SDK 로드 완료 여부 (false면 로딩 스피너)
  const [zoom,     setZoom]     = useState(4);     // 현재 줌 레벨 (마커↔클러스터 전환 기준)
  const [cctvList, setCctvList] = useState([]);    // 스프링 /api/cctv에서 받은 CCTV 목록
  const [showCctv, setShowCctv] = useState(false); // CCTV 마커 표시 여부 (토글 버튼)
  const [showSignal, setShowSignal] = useState(true); // 신호등 마커 표시 여부 (토글 버튼)

  // ── 교통량 추가 ────────────────────────────────────────────
  const trafficOverlays = useRef([]); // 교통량 오버레이 관리용
  const [showTraffic, setShowTraffic] = useState(false); // 교통량 마커 토글 상태
  const [activeStation, setActiveStation] = useState(null); // 클릭된 지점 상세 정보
  const [forecastDir, setForecastDir] = useState("up"); // "up" | "down"
  const stationDetailOverlay = useRef(null); // 상세정보 오버레이 관리용

  const areaCctvList = useMemo(
    () => cctvList.filter(cctv => isWithinSelectedGu(cctv, selectedGu, 2.5)),
    [cctvList, selectedGu]
  );

  const areaStations = useMemo(
    () => stations.filter(st => isWithinSelectedGu(st, selectedGu, 2.5)),
    [stations, selectedGu]
  );

  useEffect(() => {
    setActiveStation(null);
  }, [selectedGu?.name]);

  useEffect(() => {
    setForecastDir("up");
  }, [activeStation]);


  // ── 멀티에이전트 분석 다이아몬드 오버레이 ─────────────────────────────────
  useEffect(() => {
    function clearAnalyzeOverlays() {
      const ao = analyzeOverlays.current;
      if (ao.timer) { clearInterval(ao.timer); ao.timer = null; }
      ao.lines.forEach(l => l.setMap(null));
      ao.pings.forEach(p => p.setMap(null));
      ao.lines = []; ao.pings = [];
    }

    function onInit(e) {
      if (!mapObj.current || !window.kakao?.maps) return;
      clearAnalyzeOverlays();
      const kakao = window.kakao;
      const { center, workers } = e.detail;
      const centerPos = new kakao.maps.LatLng(center.lat, center.lon);

      workers.forEach(w => {
        if (w.lat == null || w.lon == null) return;
        const wPos = new kakao.maps.LatLng(w.lat, w.lon);

        // 중심→워커 연결선
        const line = new kakao.maps.Polyline({
          path: [centerPos, wPos],
          strokeWeight: 5,
          strokeColor: "#000000",
          strokeOpacity: 0.85,
          strokeStyle: "shortdash",
          map: mapObj.current,
        });
        analyzeOverlays.current.lines.push(line);

        // 워커 위치 핑 오버레이
        const pingEl = document.createElement("div");
        pingEl.style.cssText = `
          width:36px;height:36px;border-radius:50%;
          border:3px solid rgba(0,0,0,0.95);
          background:rgba(0,0,0,0.2);
          animation:mapPingPulse 1.4s ease-out infinite;
          transform:translate(-50%,-50%);
        `;
        const ping = new kakao.maps.CustomOverlay({
          position: wPos, content: pingEl,
          xAnchor: 0.5, yAnchor: 0.5, zIndex: 10,
          map: mapObj.current,
        });
        analyzeOverlays.current.pings.push(ping);
      });

      // 선 투명도 맥박 애니메이션
      let phase = 0;
      analyzeOverlays.current.timer = setInterval(() => {
        phase += 0.12;
        const op = 0.35 + 0.45 * Math.abs(Math.sin(phase));
        analyzeOverlays.current.lines.forEach(l => l.setOptions({ strokeOpacity: op }));
      }, 60);
    }

    function onDone() { clearAnalyzeOverlays(); }

    window.addEventListener("multiAnalyzeInit", onInit);
    window.addEventListener("multiAnalyzeDone", onDone);
    return () => {
      window.removeEventListener("multiAnalyzeInit", onInit);
      window.removeEventListener("multiAnalyzeDone", onDone);
      clearAnalyzeOverlays();
    };
  }, [ready]);

  // ── useEffect 1: 카카오맵 SDK 동적 로드 ────────────────────────────────────
  // 카카오맵 SDK는 index.html에 미리 넣지 않고 컴포넌트 마운트 시 동적으로 삽입.
  // 이유: API 키를 .env에서 가져와야 하고, 지도 페이지에서만 필요하기 때문.
  useEffect(() => {
    const KEY = import.meta.env.VITE_KAKAO_APP_KEY;

    // 케이스 1: 이미 SDK가 로드된 경우 (다른 컴포넌트가 먼저 로드했거나 HMR 재마운트)
    if (window.kakao?.maps) { setReady(true); return; }

    // 케이스 2: script 태그가 삽입됐지만 아직 로드 중인 경우 → 100ms 폴링으로 완료 대기
    if (document.querySelector("script[data-kakao]")) {
      const id = setInterval(() => {
        if (window.kakao?.maps) { clearInterval(id); setReady(true); }
      }, 100);
      return;
    }

    // 케이스 3: 최초 로드 → script 태그 동적 삽입
    // libraries=clusterer: MarkerClusterer 사용
    // libraries=services: 주소 검색 등 (현재 미사용, 확장 대비)
    // autoload=false: 수동으로 kakao.maps.load() 호출해서 초기화
    const s = document.createElement("script");
    s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&libraries=clusterer,services&autoload=false`;
    s.setAttribute("data-kakao", "1"); // 중복 삽입 방지용 식별자
    s.onload = () => window.kakao.maps.load(() => setReady(true));
    document.head.appendChild(s);
  }, []); // 마운트 1회만 실행

  // ── useEffect 2: 지도 초기화 (SDK 로드 완료 후 1회) ────────────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const kakao = window.kakao;

    // initialCenter: 통합 대시보드에서 구 클릭 시 해당 구 좌표 전달됨
    // 없으면 잠실역 기본값
    const centerLat = initialCenter?.lat ?? DEFAULT_LAT;
    const centerLon = initialCenter?.lon ?? DEFAULT_LON;

    const map = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(centerLat, centerLon),
      level: 4, // 초기 줌 레벨 (1=가장 확대, 14=가장 축소)
    });
    mapObj.current = map;

    // 다크 모드 필터: 카카오맵 기본 밝은 배경을 어둡게 변환
    // invert(90%): 명암 반전, hue-rotate(180deg): 색상 반전 보정
    // brightness(0.85) saturate(0.9): 채도/밝기 미세 조정
    mapRef.current.style.filter = "invert(90%) hue-rotate(180deg) brightness(0.85) saturate(0.9)";

    // 줌 변경 이벤트 → zoom state 업데이트 → 마커/클러스터 전환 트리거
    kakao.maps.event.addListener(map, "zoom_changed", () => setZoom(map.getLevel()));

    // MarkerClusterer: 줌 레벨 5 미만에서 가까운 마커들을 하나의 원으로 묶어 표시
    // minLevel: 5 → 줌 5 미만(더 축소된 상태)에서 클러스터 활성화
    // averageCenter: 클러스터 중심을 포함 마커들의 평균 위치로 설정
    signalClusterer.current = new kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: CLUSTER_LEVEL,
      gridSize: 72,
      minClusterSize: 2,
      styles: [{
        width: "46px", height: "46px",
        background: "rgba(30, 99, 160, 0.96)",
        borderRadius: "50%",
        border: "2px solid rgba(147, 197, 253, 0.95)",
        color: "#e0f2fe",
        fontSize: "14px", fontWeight: "800",
        lineHeight: "46px", textAlign: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
      }],
    });

    cctvClusterer.current = new kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: CLUSTER_LEVEL,
      gridSize: 78,
      minClusterSize: 2,
      styles: [{
        width: "46px", height: "46px",
        background: "rgba(22, 101, 52, 0.96)",
        borderRadius: "50%",
        border: "2px solid rgba(134, 239, 172, 0.95)",
        color: "#dcfce7",
        fontSize: "14px", fontWeight: "800",
        lineHeight: "46px", textAlign: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
      }],
    });

    trafficClusterer.current = new kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: CLUSTER_LEVEL,
      gridSize: 78,
      minClusterSize: 2,
      styles: [{
        width: "46px", height: "46px",
        background: "rgba(120, 72, 30, 0.96)",
        borderRadius: "50%",
        border: "2px solid rgba(245, 214, 181, 0.95)",
        color: "#fff7ed",
        fontSize: "14px", fontWeight: "800",
        lineHeight: "46px", textAlign: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
      }],
    });
  }, [ready]); // ready가 true로 바뀔 때 1회 실행

  // ── useEffect 3: 교차로 마커 업데이트 ──────────────────────────────────────
  // crossroads(새 신호 데이터), selected(선택 교차로), zoom(줌 레벨) 변경 시마다 실행
  // 매번 기존 오버레이를 전부 제거하고 새로 생성 (diffing 없이 전체 재생성)
  useEffect(() => {
    if (!ready || !mapObj.current) return;
    const kakao = window.kakao;

    // 기존 신호등 오버레이/클러스터 전부 제거
    Object.values(overlays.current).forEach(ov => ov.setMap(null));
    overlays.current = {};
    signalClusterer.current?.clear();

    if (!showSignal) return;

    const makeSignalMarkerImage = () => {
      const svg = `
        <svg width="34" height="46" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg">
          <path d="M17 44 C17 44 4 28 4 17 A13 13 0 1 1 30 17 C30 28 17 44 17 44Z" fill="#2b7fc3" stroke="#0f3d66" stroke-width="3"/>
          <circle cx="17" cy="17" r="6" fill="#0b1726" stroke="#a7d8ff" stroke-width="2"/>
        </svg>`;
      const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
      return new kakao.maps.MarkerImage(url, new kakao.maps.Size(34, 46), {
        offset: new kakao.maps.Point(17, 44),
      });
    };

    if (zoom < CLUSTER_LEVEL) {
      // ── 줌인 상태: 교차로별 개별 CustomOverlay 표시 ──
      crossroads.forEach(cr => {
        const pos   = new kakao.maps.LatLng(cr.lat, cr.lon);
        const isSel = selected?.crsrdId === cr.crsrdId;
        // domColor: mappedSignals의 신호 상태 → 빨강/노랑/초록 색상 반환
        const color = domColor(cr.mappedSignals);

        // 신호등 마커: 기본은 파란 핀만 표시, 선택된 마커만 이름 라벨 표시
        const el = document.createElement("div");
        el.style.cssText = "cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:0;";
        el.title = cr.crsrdNm;
        el.innerHTML = `
          ${isSel ? `
            <div style="padding:3px 8px;background:rgba(18,14,10,0.94);border:1px solid rgba(78,166,255,0.65);border-radius:5px;color:#4ea6ff;font-size:11px;font-weight:800;white-space:nowrap;font-family:Malgun Gothic,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.45);">
              ${cr.crsrdNm}
            </div>
          ` : ""}
          <svg width="${isSel ? 38 : 32}" height="${isSel ? 50 : 42}" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg" style="display:block;">
            <path d="M17 44 C17 44 4 28 4 17 A13 13 0 1 1 30 17 C30 28 17 44 17 44Z" fill="#2b7fc3" stroke="#0f3d66" stroke-width="3"/>
            <circle cx="17" cy="17" r="6" fill="#0b1726" stroke="#a7d8ff" stroke-width="2"/>
          </svg>
        `;

        const ov = new kakao.maps.CustomOverlay({
          position: pos,
          content: el,
          zIndex: isSel ? 10 : 3,
          xAnchor: 0.5,
          yAnchor: 1.0,
        });
        ov.setMap(mapObj.current);
        ov.__cr = cr; // 클릭 이벤트 핸들러에서 교차로 데이터 접근용 (비표준 속성)
        overlays.current[cr.crsrdId] = ov;
      });

    } else {
      // ── 줌아웃 상태: MarkerClusterer에 기본 마커 추가 ──
      // CustomOverlay는 클러스터러가 지원하지 않아 기본 Marker 사용
      // 클릭 이벤트는 kakao.maps.event.addListener로 직접 등록
      if (signalClusterer.current) {
        const image = makeSignalMarkerImage();
        const markers = crossroads.map(cr => {
          const m = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(cr.lat, cr.lon),
            image,
          });
          kakao.maps.event.addListener(m, "click", () => onSelect(cr));
          return m;
        });
        signalClusterer.current.addMarkers(markers);
      }
    }
  }, [ready, crossroads, selected, zoom, showSignal, onSelect]);

  // ── useEffect 4: 선택된 교차로로 지도 이동 ─────────────────────────────────
  // selected.crsrdId 기준으로 실행 (같은 교차로의 신호 데이터만 갱신되면 이동 안 함)
  useEffect(() => {
    if (!ready || !mapObj.current || !selected?.lat || !selected?.lon) return;
    // panTo: 즉시 이동이 아닌 부드러운 애니메이션 이동
    mapObj.current.panTo(new window.kakao.maps.LatLng(selected.lat, selected.lon));
  }, [ready, selected?.crsrdId]); // crsrdId가 바뀔 때만 실행

  // 민원 클릭 시 해당 위치로 이동
  useEffect(() => {
    if (!ready || !mapObj.current || !complaintCenter?.lat || !complaintCenter?.lng) return;
    const pos = new window.kakao.maps.LatLng(complaintCenter.lat, complaintCenter.lng);
    mapObj.current.setCenter(pos);
    mapObj.current.setLevel(4);
  }, [ready, complaintCenter?._t]);

  // ── useEffect 5: CCTV 목록 로드 ────────────────────────────────────────────
  // 마운트 시 1회: 스프링 /api/cctv → Oracle DB CCTV3 테이블 전체 조회
  // CCTV 마커 버튼 클릭 전에 미리 로드해둠 (토글 시 즉시 표시)
  useEffect(() => {
    fetch(`${API_BASE}/api/cctv`)
      .then(r => r.json())
      .then(data => setCctvList(data))
      .catch(() => {}); // 실패 시 조용히 무시 (마커 없음으로 처리)
  }, []);

  // ── useEffect 6: CCTV 마커 토글 ────────────────────────────────────────────
  // showCctv 또는 cctvList, zoom 변경 시 실행
  useEffect(() => {
    if (!ready || !mapObj.current) return;
    const kakao = window.kakao;

    // 기존 CCTV 오버레이/클러스터 전부 제거
    cctvOverlays.current.forEach(ov => ov.setMap(null));
    cctvOverlays.current = [];
    cctvClusterer.current?.clear();
    if (!showCctv) return;

    const makeCctvMarkerImage = () => {
      const svg = `
        <svg width="44" height="48" viewBox="0 0 44 48" xmlns="http://www.w3.org/2000/svg">
          <rect x="6" y="3" width="32" height="29" rx="7" fill="#ffffff" stroke="#22c55e" stroke-width="3"/>
          <rect x="12" y="11" width="18" height="13" rx="2" fill="#1e293b"/>
          <polygon points="30,14 36,12 36,24 30,22" fill="#1e293b"/>
          <circle cx="21" cy="17.5" r="4" fill="#334155"/>
          <circle cx="21" cy="17.5" r="2.1" fill="#0f172a"/>
          <rect x="16" y="7" width="6" height="3" rx="1" fill="#1e293b"/>
          <path d="M22 46 L17 32 H27 Z" fill="#ffffff" opacity="0.95"/>
          <circle cx="22" cy="41" r="4" fill="#ffffff" opacity="0.95"/>
        </svg>`;
      const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
      return new kakao.maps.MarkerImage(url, new kakao.maps.Size(44, 48), {
        offset: new kakao.maps.Point(22, 44),
      });
    };

    if (zoom >= CLUSTER_LEVEL) {
      // 줌아웃 상태: CCTV를 클러스터로 묶어서 표시
      const image = makeCctvMarkerImage();
      const markers = areaCctvList.map(cctv => {
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(cctv.lat, cctv.lon),
          image,
        });
        kakao.maps.event.addListener(marker, "click", () => onCctvClick?.(cctv));
        return marker;
      });
      cctvClusterer.current?.addMarkers(markers);
      return;
    }

    areaCctvList.forEach(cctv => {
      const pos = new kakao.maps.LatLng(cctv.lat, cctv.lon);

      // CCTV 마커: DOM 요소 직접 생성 (innerHTML로 SVG + 텍스트 삽입)
      const el = document.createElement("div");
      el.style.cssText = "cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.8))";
      el.title = cctv.cctvNm;
      el.innerHTML = `
        <div style="background:#fff;border-radius:8px;padding:5px 6px;display:flex;flex-direction:column;align-items:center;gap:2px;border:2px solid ${cctv.streamId ? '#22c55e' : '#9ca3af'}">
          <svg width="28" height="22" viewBox="0 0 38 30" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="6" width="24" height="18" rx="3" fill="#1e293b"/>
            <polygon points="26,11 34,8 34,22 26,19" fill="#1e293b"/>
            <circle cx="14" cy="15" r="5.5" fill="#334155"/>
            <circle cx="14" cy="15" r="3" fill="#0f172a"/>
            <circle cx="12.5" cy="13.5" r="1.2" fill="#fff" opacity="0.7"/>
            <rect x="8" y="3" width="7" height="3" rx="1" fill="#1e293b"/>
            <rect x="20" y="9" width="3" height="3" rx="0.5" fill="#94a3b8"/>
          </svg>
          <div style="font-size:9px;color:#1e293b;font-weight:700;font-family:Malgun Gothic,sans-serif;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2">
            ${cctv.cctvNm.length > 6 ? cctv.cctvNm.slice(0, 6) + '…' : cctv.cctvNm}
          </div>
        </div>
        <div style="width:2px;height:6px;background:#fff;opacity:0.9"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:#fff;opacity:0.9"></div>`;

      el.addEventListener("click", e => { e.stopPropagation(); onCctvClick?.(cctv); });

      const ov = new kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        zIndex: 5,
        xAnchor: 0.5,
        yAnchor: 1.0,
      });
      ov.setMap(mapObj.current);
      cctvOverlays.current.push(ov);
    });
  }, [ready, showCctv, areaCctvList, onCctvClick, zoom]);

  
  // ── useEffect 7: 교통량 지점(AI Station) 마커 표시 ─────────────────────────────
  useEffect(() => {
    if (!ready || !mapObj.current) return;
    const kakao = window.kakao;

    // 기존 교통량 오버레이/클러스터 제거
    trafficOverlays.current.forEach(ov => ov.setMap(null));
    trafficOverlays.current = [];
    trafficClusterer.current?.clear();

    if (!showTraffic) return;

    const makeTrafficMarkerImage = () => {
      const svg = `
        <svg width="34" height="46" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg">
          <path d="M17 44 C17 44 4 28 4 17 A13 13 0 1 1 30 17 C30 28 17 44 17 44Z" fill="#8b5a2b" stroke="#2f1b0c" stroke-width="3"/>
          <circle cx="17" cy="17" r="6" fill="#111827" stroke="#e8d2bd" stroke-width="2"/>
        </svg>`;
      const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
      return new kakao.maps.MarkerImage(url, new kakao.maps.Size(34, 46), {
        offset: new kakao.maps.Point(17, 44),
      });
    };

    if (zoom >= CLUSTER_LEVEL) {
      // 줌아웃 상태: 교통량 지점을 클러스터로 묶어서 표시
      const image = makeTrafficMarkerImage();
      const markers = areaStations.map(st => {
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(st.latitude, st.longitude),
          image,
        });
        kakao.maps.event.addListener(marker, "click", () => {
          setActiveStation(st.stationId);
          onStationSelect?.(st.stationId);
        });
        return marker;
      });
      trafficClusterer.current?.addMarkers(markers);
      return;
    }

    areaStations.forEach(st => {
      const pos = new kakao.maps.LatLng(st.latitude, st.longitude);

      // 마커 디자인: 파란 교차로 마커와 같은 핀 형태, 색상만 갈색으로 표시
      const el = document.createElement("div");
      el.style.cssText = "cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:0;";
      el.innerHTML = `
        <div style="padding:3px 7px;background:rgba(18,14,10,0.92);border:1px solid rgba(139,90,43,0.8);border-radius:5px;color:#d8b48a;font-size:11px;font-weight:800;white-space:nowrap;font-family:Malgun Gothic,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.45);">
          ${st.stationName}
        </div>
        <div style="width:34px;height:46px;display:flex;align-items:center;justify-content:center;">
          <svg width="34" height="46" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg" style="display:block;">
            <path d="M17 44 C17 44 4 28 4 17 A13 13 0 1 1 30 17 C30 28 17 44 17 44Z" fill="#8b5a2b" stroke="#2f1b0c" stroke-width="3"/>
            <circle cx="17" cy="17" r="6" fill="#111827" stroke="#e8d2bd" stroke-width="2"/>
          </svg>
        </div>
      `;

      // 마커 클릭 이벤트: activeStation 상태 업데이트 + 부모 콜백 호출
      el.onclick = (e) => {
        e.stopPropagation();
        setActiveStation(st.stationId);
        onStationSelect?.(st.stationId);
      };

      const ov = new kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        zIndex: 6,
        xAnchor: 0.5,
        yAnchor: 1.0,
      });
      ov.setMap(mapObj.current);
      trafficOverlays.current.push(ov);
    });
  }, [ready, showTraffic, areaStations, zoom, onStationSelect]);

  // ── useEffect 7-1: 상세 정보 팝업(오버레이) Fetch 및 표시 ──────────────────────
  // 상세 정보 팝업(오버레이) 관리 useEffect
  useEffect(() => {
    if (!ready || !mapObj.current) return;

    if (stationDetailOverlay.current) {
      stationDetailOverlay.current.setMap(null);
      stationDetailOverlay.current = null;
    }

    if (!activeStation) return;

    // 백엔드 ForecastController 주소와 정확히 일치시킴
    const requestUrl = `${API_BASE}/api/forecast/station/${activeStation}`;
    console.log("요청 주소:", requestUrl);

    fetch(requestUrl)
      .then(res => {
        if (!res.ok) throw new Error(`서버 에러: ${res.status}`);
        return res.json();
      })
      .then(data => {
        // ForecastResult 모델 내부의 예측 데이터 리스트 추출
        console.log("받은 데이터:", data);

        const st = areaStations.find(s => s.stationId === activeStation);
        if (!st) return;

        const currentHour = new Date().getHours();

        // 1. 단순 숫자 배열(up 또는 down)을 { hour, count } 객체 배열로 변환
        // 백엔드에서 준 up: (24) [347, 235, ...] 구조를 활용합니다.
        const selectedValues = forecastDir === "up" ? (data.up || []) : (data.down || []);
        const predictionList = selectedValues.map((val, idx) => ({
          hour: idx,
          count: val,
        }));
        
        // 2. 현재 시간 이후의 데이터만 필터링
        const futureData = predictionList.filter(item => item.hour >= currentHour);
      
        const pos = new window.kakao.maps.LatLng(st.latitude, st.longitude);
        const content = document.createElement("div");
        content.style.cssText = `
          position: relative; bottom: 54px; background: rgba(10, 20, 35, 0.96);
          border: 2px solid #ffca28; border-radius: 12px; padding: 13px;
          width: 210px; color: #fff; box-shadow: 0 6px 22px rgba(0,0,0,0.62), 0 0 16px rgba(255,202,40,0.25);
          backdrop-filter: blur(8px); z-index: 100;
        `;

        content.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,202,40,0.3); padding-bottom:5px; margin-bottom:8px;">
            <span style="font-size:14px; font-weight:bold; color:#ffffff;">${st.stationName}</span>
            <button type="button" class="traffic-close-ov" style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); color:#fff; cursor:pointer; font-size:18px;line-height:20px;display:flex;align-items:center;justify-content:center;">&times;</button>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
            <button type="button" class="forecast-dir-btn" data-dir="up"
              style="padding:5px 0; border-radius:6px; border:1px solid ${forecastDir === "up" ? "rgba(78,166,255,0.85)" : "rgba(255,255,255,0.12)"}; background:${forecastDir === "up" ? "rgba(78,166,255,0.22)" : "rgba(255,255,255,0.04)"}; color:${forecastDir === "up" ? "#93c5fd" : "#aab4c8"}; font-size:12px; font-weight:800; cursor:pointer;">
              상행
            </button>
            <button type="button" class="forecast-dir-btn" data-dir="down"
              style="padding:5px 0; border-radius:6px; border:1px solid ${forecastDir === "down" ? "rgba(255,142,85,0.85)" : "rgba(255,255,255,0.12)"}; background:${forecastDir === "down" ? "rgba(255,142,85,0.22)" : "rgba(255,255,255,0.04)"}; color:${forecastDir === "down" ? "#ffb084" : "#aab4c8"}; font-size:12px; font-weight:800; cursor:pointer;">
              하행
            </button>
          </div>
          <div style="max-height: 120px; overflow-y: auto;">
            ${futureData.length > 0 
              ? futureData.map(d => `
                  <div style="display:flex; justify-content:space-between; font-size:13px; padding:5px 0;">
                    <span style="color:#aab4c8;">${d.hour}시</span>
                    <span style="color:#fff; font-weight:700;">${Number(d.count ?? 0).toLocaleString()}대</span>
                  </div>
                `).join('')
              : '<div style="font-size:11px; color:#666; text-align:center; padding:10px;">이후 예측 데이터 없음</div>'
            }
          </div>
          <div style="position:absolute; bottom:-10px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:10px solid transparent; border-right:10px solid transparent; border-top:10px solid #ffca28;"></div>
        `;

        const closeButton = content.querySelector(".traffic-close-ov");
        closeButton?.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (stationDetailOverlay.current) {
            stationDetailOverlay.current.setMap(null);
            stationDetailOverlay.current = null;
          }
          setActiveStation(null);
        });

        content.querySelectorAll(".forecast-dir-btn").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            setForecastDir(btn.dataset.dir);
          });
        });

        const ov = new window.kakao.maps.CustomOverlay({
          position: pos,
          content: content,
          yAnchor: 1
        });

        ov.setMap(mapObj.current);
        stationDetailOverlay.current = ov;
      })
      .catch(err => {
        console.error("상세 데이터 로드 실패:", err.message);
        setActiveStation(null);
      });

  }, [activeStation, ready, areaStations, forecastDir]);

  // ── useEffect 8: 교차로 마커 클릭 이벤트 ───────────────────────────────────
  // CustomOverlay는 카카오맵 이벤트 시스템 밖의 일반 DOM이라
  // kakao.maps.event.addListener로 클릭을 잡을 수 없음.
  // → mapRef div에 직접 click 리스너 등록 후
  //   클릭된 요소가 어떤 오버레이의 DOM 안에 있는지 contains()로 확인
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const el = mapRef.current;

    const h = e => {
      Object.values(overlays.current).forEach(ov => {
        const n = ov.getContent();
        if (typeof n === "string") return; // HTML string 오버레이는 DOM 참조 불가 → 건너뜀
        if (n?.contains?.(e.target)) onSelect(ov.__cr); // 클릭된 요소가 이 오버레이 안에 있으면 선택
      });
    };

    el.addEventListener("click", h);
    // 클린업: 컴포넌트 언마운트 또는 의존성 변경 시 리스너 제거 (메모리 누수 방지)
    return () => el.removeEventListener("click", h);
  }, [ready, onSelect, onCctvClick]);

  // ── 민원 마커 업데이트 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !mapObj.current) return;
    const kakao = window.kakao;

    complaintOverlays.current.forEach(ov => ov.setMap(null));
    complaintOverlays.current = [];

    complaints.forEach(c => {
      const lat = Number(c.lat), lng = Number(c.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const statusColor = c.status === "완료" ? "#2ee07a" : c.status === "처리중" ? "#4ea6ff" : "#ffaa33";

      const el = document.createElement("div");
      // 맵 컨테이너의 CSS filter(invert+hue-rotate)를 상쇄하는 역-필터 적용
      el.style.cssText = "cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;filter:invert(1) hue-rotate(180deg) brightness(1.18) saturate(1.11);";
      el.innerHTML = `
        <div title="${(c.title || '민원').replace(/"/g, '&quot;')}" style="
          background:${statusColor};
          border:3px solid #fff;
          border-radius:50%;
          width:36px;height:36px;
          display:flex;align-items:center;justify-content:center;
          font-size:19px;
          box-shadow:0 0 14px 4px rgba(255,180,0,0.7),0 2px 8px rgba(0,0,0,0.6);
          font-family:system-ui;
          animation:complaint-pulse 1.6s infinite;
        ">⚠</div>
        <div style="
          background:rgba(0,0,0,0.82);
          color:#fff;
          font-size:10px;
          font-family:sans-serif;
          padding:2px 6px;
          border-radius:3px;
          white-space:nowrap;
          max-width:90px;
          overflow:hidden;
          text-overflow:ellipsis;
        ">${(c.category || '민원').substring(0, 8)}</div>
      `;
      el.onclick = () => onComplaintClick && onComplaintClick(c);

      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: el,
        zIndex: 8,
        xAnchor: 0.5,
        yAnchor: 1.0,
      });
      ov.setMap(mapObj.current);
      complaintOverlays.current.push(ov);
    });
  }, [ready, complaints, onComplaintClick]);

  // ── SDK 미로드 시 로딩 화면 ─────────────────────────────────────────────────
  if (!ready) return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a1020", gap: 8 }}>
      <div style={{ width: 28, height: 28, border: "3px solid rgba(59,130,246,0.3)", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <div style={{ fontSize: 12, color: "#6b7280" }}>카카오맵 로딩 중...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes complaint-pulse{0%,100%{box-shadow:0 0 14px 4px rgba(255,180,0,0.7),0 2px 8px rgba(0,0,0,0.6)}50%{box-shadow:0 0 22px 8px rgba(255,180,0,0.95),0 2px 8px rgba(0,0,0,0.6)}}`}</style>
    </div>
  );

  // ── 지도 렌더링 ─────────────────────────────────────────────────────────────
  const selectedAreaName = selectedGu?.name || initialCenter?.name || "잠실역";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <style>{`@keyframes complaint-pulse{0%,100%{box-shadow:0 0 14px 4px rgba(255,180,0,0.7),0 2px 8px rgba(0,0,0,0.6)}50%{box-shadow:0 0 22px 8px rgba(255,180,0,0.95),0 2px 8px rgba(0,0,0,0.6)}}`}</style>
      {/* 카카오맵이 실제로 렌더링되는 div (ref로 참조) */}
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

      {/* 우상단: 교통 상태 범례 (pointerEvents:none → 지도 클릭 방해 안 함) */}
      <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(18,14,10,0.88)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: "8px 11px", zIndex: 10, pointerEvents: "none", backdropFilter: "blur(4px)" }}>
        <div style={{ fontSize: 11, color: "#aab4c8", fontWeight: 700, marginBottom: 8 }}>교통 상태</div>
        {[["#2ee07a", "원활 (25km/h+)"], ["#ffaa33", "서행 (15~25km/h)"], ["#ff5566", "정체 (~15km/h)"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
            <span style={{ fontSize: 11, color: "#aab4c8" }}>{l}</span>
          </div>
        ))}
      </div>

      {/* 좌상단: 교차로 수 안내 + CCTV 마커 토글 버튼 */}
      <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 7, zIndex: 10 }}>
        {/* 교차로 수 안내 (pointerEvents:none) */}
        <div style={{ background: "rgba(18,14,10,0.88)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700, color: "#aab4c8", pointerEvents: "none", backdropFilter: "blur(4px)" }}>
          {selectedAreaName} 반경 2.5km
        </div>
        {/* 신호등 마커 토글 버튼 */}
        <button
          onClick={() => setShowSignal(v => !v)}
          style={{
            background: showSignal ? "rgba(78,166,255,0.15)" : "rgba(18,14,10,0.88)",
            border: `1px solid ${showSignal ? "rgba(78,166,255,0.55)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700,
            color: showSignal ? "#4ea6ff" : "#aab4c8",
            cursor: "pointer", fontFamily: "inherit", backdropFilter: "blur(4px)",
          }}>
          신호등 {crossroads.length}개
        </button>

        {/* CCTV 토글 버튼: 활성화 시 초록 배경/테두리로 강조 */}
        <button
          onClick={() => setShowCctv(v => !v)}
          style={{
            background: showCctv ? "rgba(34,197,94,0.15)" : "rgba(18,14,10,0.88)",
            border: `1px solid ${showCctv ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700,
            color: showCctv ? "#22c55e" : "#aab4c8",
            cursor: "pointer", fontFamily: "inherit", backdropFilter: "blur(4px)",
          }}>
          CCTV {areaCctvList.length > 0 ? `${areaCctvList.length}개` : ""}
        </button>

        {/* 교통량 지점 토글 버튼 */}
        <button
          onClick={() => setShowTraffic(v => !v)}
          style={{
            background: showTraffic ? "rgba(139,90,43,0.18)" : "rgba(18,14,10,0.88)",
            border: `1px solid ${showTraffic ? "rgba(216,180,138,0.65)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700,
            color: showTraffic ? "#d8b48a" : "#aab4c8",
            cursor: "pointer", backdropFilter: "blur(4px)",
          }}>
          교통량 지점 {areaStations.length}개
        </button>
      </div>

      {/* 하단 중앙: 클러스터 모드 안내 (zoom < 5일 때만 표시) */}
      {zoom >= CLUSTER_LEVEL && (
        <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "rgba(18,14,10,0.88)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "4px 10px", fontSize: 11, color: "#aab4c8", zIndex: 10, pointerEvents: "none", backdropFilter: "blur(4px)" }}>
          클러스터 모드 · 확대하면 마커별 위치 표시
        </div>
      )}
    </div>
  );
}
