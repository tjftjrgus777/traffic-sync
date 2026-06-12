import { useState, useEffect, useMemo, useRef } from "react";
import { distanceMeters, getCrLonLat, toCoord } from "./utils/geoUtils";
import { routeLengthMeters, interpolateRoute, estimateTripFromTraffic } from "./utils/routeUtils";
import { routeBearingDeg } from "./utils/geoUtils";
import { createMarkerCanvas } from "./utils/canvasUtils";
import { buildRouteFromSelectedList } from "./utils/routePlanUtils";
import { useVWorldViewer } from "./hooks/useVWorldViewer";
import { useTrafficLayer } from "./hooks/useTrafficLayer";
import { useRouteTraffic } from "./hooks/useRouteTraffic";
import { useCarAnimation } from "./hooks/useCarAnimation";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const SELECTED_GU_TRAFFIC_RADIUS_KM = 2.5;

export default function SimulationMapView({
  selectedList = [],
  selectedGu,
  onSelect,
  isOptimized = false,
  onStatsChange,
  onAutoWaypointsChange,
  onRouteTrafficChange,
  onCurrentSignalChange,
  onResetRoute,
  onDriveViewChange,
  carReady = false,
  optimizedRouteTraffic = null,
}) {
  const markerEntitiesRef = useRef({});
  const routePointsRef = useRef([]);
  const viaCrossroadsRef = useRef([]);
  const routeClearingRef = useRef(false);
  const startRef = useRef(null);
  const endRef = useRef(null);
  const destroyCallbackRef = useRef(null);
  

  const [crossroads, setCrossroads] = useState([]);
  const [driveView, setDriveView] = useState(false);
  const [routePlan, setRoutePlan] = useState({ points: [], viaCrossroads: [] });

  const start = selectedList[0] ?? null;
  const end = selectedList.length >= 2 ? selectedList[selectedList.length - 1] : null;
  const isSimulationActive = !!(start && end);
  const startLL = getCrLonLat(start);
  const endLL = getCrLonLat(end);
  const routePoints = routePlan.points;
  const viaCrossroads = routePlan.viaCrossroads;

  const selectedGuLat = Number(selectedGu?.lat);
  const selectedGuLon = Number(selectedGu?.lon);
  const hasSelectedGuCenter = Number.isFinite(selectedGuLat) && Number.isFinite(selectedGuLon);
  const selectedGuLL = hasSelectedGuCenter ? { lon: selectedGuLon, lat: selectedGuLat } : null;
  const trafficAreaKey = hasSelectedGuCenter
    ? `${selectedGu?.name || "selected"}:${selectedGuLat}:${selectedGuLon}`
    : "all";
  const trafficAreaQuery = useMemo(() => {
    if (!hasSelectedGuCenter) return "";
    return `?${new URLSearchParams({ centerLat: String(selectedGuLat), centerLon: String(selectedGuLon), radiusKm: String(SELECTED_GU_TRAFFIC_RADIUS_KM) })}`;
  }, [hasSelectedGuCenter, selectedGuLat, selectedGuLon]);

  // ─── 훅 초기화 ────────────────────────────────────────────────────────────

  const { containerRef, viewerRef, mapReady, cesiumReady, status } = useVWorldViewer({
    startLL, selectedGuLL, markerEntitiesRef, destroyCallbackRef,
  });

  const {
    trafficLayerInfo, clearTrafficLayer,
    renderTrafficLayerInBatches, updateTrafficLinkEntity,
  } = useTrafficLayer({
    viewerRef, trafficAreaQuery, trafficAreaKey, mapReady, driveView, isSimulationActive,
  });

  // const {
  //   routeTraffic, routeTrafficRef,
  //   fetchSignalCtx, prefetchSignals,
  //   getBackendMovementForNode, getReverseBackendMovementForNode,
  // } = useRouteTraffic({
  //   start, end, viaCrossroads, routePoints, routePointsRef,
  //   onRouteTrafficChange,
  // });
  const {
    routeTraffic, routeTrafficRef,
    fetchSignalCtx, prefetchSignals,
    getBackendMovementForNode, getReverseBackendMovementForNode,
  } = useRouteTraffic({
    start,
    end,
    viaCrossroads,
    routePoints,
    routePointsRef,
    onRouteTrafficChange,
    onBlockedLeftTurn: handleBlockedLeftTurn,
  });

  const activeRouteTraffic = isOptimized && optimizedRouteTraffic?.segments?.length
    ? optimizedRouteTraffic
    : routeTraffic;

  useEffect(() => {
    routeTrafficRef.current = activeRouteTraffic;
  }, [activeRouteTraffic, routeTrafficRef]);

  const {
    animationRef, progressRef, reverseProgressRef,
    signalCacheRef, signalFetchingRef,
    simulationCompleted, carEntityRef, reverseCarEntityRef,
    clearOverlays, stopAnimation, restartRouteAnimation,
    flyToSelectedArea, renderRouteSimulation, startCarAnimation, moveDriveCamera,
    emitCurrentSignalStatus,
  } = useCarAnimation({
    viewerRef, routePointsRef, viaCrossroadsRef, startRef, endRef,
    routeTrafficRef, fetchSignalCtx,
    getBackendMovementForNode, getReverseBackendMovementForNode,
    isOptimized, driveView, onCurrentSignalChange,
  });

  function handleBlockedLeftTurn(blockedLeftTurn) {
    routeClearingRef.current = true;

    routePointsRef.current = [];
    viaCrossroadsRef.current = [];
    startRef.current = null;
    endRef.current = null;

    stopAnimation();
    clearOverlays();

    setRoutePlan({ points: [], viaCrossroads: [] });

    onRouteTrafficChange?.(null);
    onCurrentSignalChange?.(null);
    onStatsChange?.(null);
    onAutoWaypointsChange?.([]);

    onResetRoute?.();

    setTimeout(() => {
      clearOverlays();
      viewerRef.current?.scene?.requestRender?.();

      alert(`${blockedLeftTurn.node.intNm} 교차로의 해당 방향은 좌회전 신호가 없어 경로를 연결할 수 없습니다.`);
      routeClearingRef.current = false;
    }, 50);
  }

  // destroyCallbackRef: useVWorldViewer 언마운트 전 다른 훅 정리
  destroyCallbackRef.current = () => {
    stopAnimation(false);
    clearOverlays();
    clearTrafficLayer();
  };

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => { onDriveViewChange?.(driveView); }, [driveView, onDriveViewChange]);

  // 교차로 목록 로드
  useEffect(() => {
    fetch(`${API_BASE}/api/signal/crossroads`)
      .then(r => r.json())
      .then(data => setCrossroads(data.filter(c => toCoord(c.xCoord) && toCoord(c.yCoord))))
      .catch(() => console.warn("교차로 데이터 로드 실패"));
  }, []);

  
  // 경로 계획 재계산
  useEffect(() => {
    if (routeClearingRef.current) return;

    if (selectedList.length < 2) {
      setRoutePlan({ points: [], viaCrossroads: [] });
      return;
    }

    setRoutePlan(buildRouteFromSelectedList(selectedList, crossroads));
  }, [
    selectedList.map(i => i.intNo).join("|"),
    crossroads.length,
  ]);

  // 자동 경유지 변경 알림
  useEffect(() => {
    onAutoWaypointsChange?.(viaCrossroads);
  }, [start?.intNo, end?.intNo, viaCrossroads.map(cr => cr.intNo).join("|"), onAutoWaypointsChange]);

  // refs를 최신 상태로 동기화
  useEffect(() => {
    routePointsRef.current = routePoints;
    viaCrossroadsRef.current = viaCrossroads;
    startRef.current = start;
    endRef.current = end;
  }, [routePoints, viaCrossroads, start?.intNo, end?.intNo]);

  // 애니메이션 재시작 (경로/최적화 변경 시)
  useEffect(() => {
    if (!mapReady || routePointsRef.current.length < 2) return;
    if (simulationCompleted) return;
    if (animationRef.current) return;
    animationRef.current = requestAnimationFrame(startCarAnimation);
  }, [mapReady, routePlan, isOptimized, simulationCompleted]);

  // 선택된 구로 카메라 이동 (출발지 미선택 시)
  useEffect(() => {
    if (!mapReady || !viewerRef.current || !window.Cesium || !selectedGuLL || startLL) return;
    const Cesium = window.Cesium;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(selectedGuLL.lon, selectedGuLL.lat, 1200),
      orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-45), roll: 0 },
      duration: 0.55,
    });
  }, [mapReady, selectedGuLat, selectedGuLon, start?.intNo]);

  // 선택 없을 때 기본 카메라 위치 복원
  useEffect(() => {
    if (!mapReady || !viewerRef.current || selectedList.length > 0 || !window.Cesium) return;
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    const center = selectedGuLL || { lon: 127.0396, lat: 37.5126 };
    const timer = setTimeout(() => {
      try {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 1200),
          orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-45), roll: 0 },
        });
        viewer.scene.requestRender?.();
      } catch (err) {
        console.warn("기본 카메라 위치 복원 실패", err);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [mapReady, selectedList.length, selectedGuLat, selectedGuLon]);

  // 교차로 마커 렌더링
  useEffect(() => {
    if (!mapReady || !viewerRef.current || crossroads.length === 0) return;
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    Object.values(markerEntitiesRef.current).forEach(e => viewer.entities.remove(e));
    markerEntitiesRef.current = {};

    crossroads.forEach(cr => {
      const lon = toCoord(cr.xCoord);
      const lat = toCoord(cr.yCoord);
      if (!lon || !lat || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const isStart = start?.intNo === cr.intNo;
      const isEnd = end?.intNo === cr.intNo;
      const viaIndex = viaCrossroads.findIndex(v => v.intNo === cr.intNo);
      const isVia = viaIndex >= 0;
      const shouldFilter = driveView && routePoints.length >= 2 && selectedList.length >= 2;
      if (shouldFilter && !isStart && !isEnd && !isVia) return;
      const color = isStart ? "#22c55e" : isEnd ? "#ef4444" : isVia ? "#f59e0b" : "rgba(96,165,250,0.65)";
      const size = isStart || isEnd ? 18 : isVia ? 13 : 11;
      const markerText = isStart ? "출" : isEnd ? "도" : isVia ? String(viaIndex + 1) : "";
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 10),
        billboard: {
          image: createMarkerCanvas(color, size, markerText),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 1e10,
        },
        label: (isStart || isEnd || isVia) ? {
          text: isVia ? `경유 ${viaIndex + 1} · ${cr.intNm}` : `${isStart ? "출발" : "도착"} · ${cr.intNm}`,
          font: "bold 12px Malgun Gothic",
          fillColor: Cesium.Color.fromCssColorString(isStart ? "#22c55e" : isEnd ? "#ef4444" : "#f59e0b"),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -32),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 1e10,
        } : undefined,
        properties: { intNo: cr.intNo, intNm: cr.intNm, xCoord: cr.xCoord, yCoord: cr.yCoord },
      });
      markerEntitiesRef.current[cr.intNo] = entity;
    });

    // 핸들러를 매번 새로 등록해서 onSelect/crossroads 클로저가 최신 값을 유지하도록 함
    if (viewer._routeSimClickHandler) {
      viewer._routeSimClickHandler.destroy?.();
      viewer._routeSimClickHandler = null;
    }
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    viewer._routeSimClickHandler = handler;
    handler.setInputAction(click => {
      const picked = viewer.scene.pick(click.position);
      if (picked?.id?.properties) {
        const intNo = picked.id.properties.intNo?.getValue();
        const intNm = picked.id.properties.intNm?.getValue();
        const xCoord = picked.id.properties.xCoord?.getValue();
        const yCoord = picked.id.properties.yCoord?.getValue();
        if (intNo) { onSelect?.({ intNo, intNm, xCoord, yCoord }); return; }
      }
      // 마커 픽셀 pick 실패 시 → 클릭 위치와 가까운 교차로를 거리 기준으로 선택
      try {
        const cartesian = viewer.scene.pickPosition?.(click.position)
          || viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (!cartesian) return;
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const clicked = { lon: Cesium.Math.toDegrees(cartographic.longitude), lat: Cesium.Math.toDegrees(cartographic.latitude) };
        let nearest = null, nearestDistance = Infinity;
        crossroads.forEach(cr => {
          const ll = getCrLonLat(cr);
          if (!ll) return;
          const d = distanceMeters(clicked, ll);
          if (d < nearestDistance) { nearest = cr; nearestDistance = d; }
        });
        if (nearest && nearestDistance <= 100) {
          onSelect?.({ intNo: nearest.intNo, intNm: nearest.intNm, xCoord: nearest.xCoord, yCoord: nearest.yCoord });
        }
      } catch {
        // pickPosition 실패는 무시
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }, [
    crossroads, start?.intNo, end?.intNo,
    viaCrossroads.map(cr => cr.intNo).join("|"),
    routePoints.length, selectedList.length, driveView, cesiumReady, mapReady, onSelect,
  ]);

  // 경로/출발지/목적지 변경 시 시뮬레이션 재시작 (메인 코디네이션 effect)
  useEffect(() => {
    if (!mapReady || !viewerRef.current || !window.Cesium) return;
    clearOverlays();
    stopAnimation();
    if (!startLL) {
      onStatsChange?.(null);
      emitCurrentSignalStatus(null, false, null, null);
      return;
    }
    flyToSelectedArea(startLL, endLL, routePoints);
    if (!endLL || routePoints.length < 2) {
      onStatsChange?.(null);
      emitCurrentSignalStatus(null, false, null, null);
      return;
    }
    routePointsRef.current = routePoints;
    viaCrossroadsRef.current = viaCrossroads;
    startRef.current = start;
    endRef.current = end;
    routeTrafficRef.current = activeRouteTraffic;
    renderRouteSimulation(routePoints, viaCrossroads, startLL, endLL);
    prefetchSignals(viaCrossroads, start, end, signalCacheRef, signalFetchingRef);
    animationRef.current = requestAnimationFrame(startCarAnimation);
    const currentStats = estimateTripFromTraffic(routePoints, routeTraffic);
    if (!currentStats) {
      onStatsChange?.({
        distanceMeters: Math.round(routeLengthMeters(routePoints)),
        minSpeedKph: null,
        bottleneckCount: 0, viaCount: viaCrossroads.length,
        speedMissing: true, realTimeSpeed: false, segmentsCount: 0,
      });
      return;
    }
    onStatsChange?.({
      distanceMeters: Math.round(currentStats.distance),
      minSpeedKph: currentStats.minSpeedKph,
      bottleneckCount: currentStats.bottleneckCount,
      viaCount: viaCrossroads.length,
      speedMissing: currentStats.speedMissing,
      realTimeSpeed: currentStats.realTimeSpeed,
      segmentsCount: currentStats.segmentsCount,
    });
  }, [selectedList, isOptimized, mapReady, routePlan, driveView, routeTraffic, activeRouteTraffic]);

  // 주행뷰 전환 시 카메라
  useEffect(() => {
    if (!mapReady || !viewerRef.current || !window.Cesium || !routePoints.length) return;
    if (driveView) {
      const p = interpolateRoute(routePoints, progressRef.current || 0.02);
      const next = interpolateRoute(routePoints, Math.min((progressRef.current || 0.02) + 0.012, 1));
      if (p && next) moveDriveCamera(p, routeBearingDeg(p, next), false);
    } else {
      flyToSelectedArea(startLL, endLL, routePoints);
    }
  }, [driveView, mapReady]);


  // 페이지를 떠났다가 다시 시뮬레이션 페이지로 돌아왔을 때
  // display:none 상태였던 VWorld/Cesium canvas를 강제로 다시 렌더링한다.
  useEffect(() => {
    const reviveSimulationViewer = () => {
      const run = () => {
        const viewer = viewerRef.current;
        if (!viewer || !window.Cesium) return;

        try {
          viewer.resize?.();
          viewer.scene?.requestRender?.();
        } catch (err) {
          console.warn("[SimMap] VWorld viewer 재활성화 실패:", err);
        }

        const currentRoutePoints = routePointsRef.current || [];
        const currentViaCrossroads = viaCrossroadsRef.current || [];
        const currentStart = startRef.current;
        const currentEnd = endRef.current;

        if (currentRoutePoints.length < 2 || !currentStart || !currentEnd) return;

        const currentStartLL = getCrLonLat(currentStart);
        const currentEndLL = getCrLonLat(currentEnd);
        if (!currentStartLL || !currentEndLL) return;

        // 숨김/표시 전환 후 차량 엔티티가 사라진 경우 경로 오버레이와 차량을 복원한다.
        if (!carEntityRef.current || !reverseCarEntityRef.current) {
          clearOverlays();
          renderRouteSimulation(currentRoutePoints, currentViaCrossroads, currentStartLL, currentEndLL);
          prefetchSignals(currentViaCrossroads, currentStart, currentEnd, signalCacheRef, signalFetchingRef);
        }

        // RAF가 멈춘 상태면 다시 시작한다.
        if (!animationRef.current && !simulationCompleted) {
          animationRef.current = requestAnimationFrame(startCarAnimation);
        }

        viewer.scene?.requestRender?.();
      };

      setTimeout(run, 60);
      setTimeout(run, 320);
    };

    window.addEventListener("traffic-sync:simulation-activate", reviveSimulationViewer);

    if (mapReady) {
      reviveSimulationViewer();
    }

    return () => {
      window.removeEventListener("traffic-sync:simulation-activate", reviveSimulationViewer);
    };
  }, [mapReady, simulationCompleted]);

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#0a0f1e" }}>
      <div id="vworld-simulation-map" ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {status && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#93c5fd", background: "rgba(10,15,30,0.85)", zIndex: 5, pointerEvents: "none" }}>
          {status}
        </div>
      )}

      <div style={{ position: "absolute", top: 14, left: 14, zIndex: 10, padding: "10px 14px", borderRadius: 6, background: "rgba(18,16,10,0.88)", border: "1px solid rgba(255,255,255,0.12)", color: "#dbeafe", fontSize: 12 }}>
        <div style={{ fontWeight: 800, color: "#60a5fa", marginBottom: 4 }}>VWorld WebGL 3D 신호 시뮬레이션</div>
        <div>1. 출발지 마커 클릭 → 2. 목적지 마커 클릭</div>
      </div>

      <div style={{ position: "absolute", right: 16, bottom: 14, zIndex: 12, display: "flex", gap: 8 }}>
        <button
          onClick={() => setDriveView(false)}
          style={{ border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 14px", cursor: "pointer", color: "#fff", fontWeight: 800, background: !driveView ? "#3b82f6" : "rgba(15,23,42,0.82)", boxShadow: "0 8px 20px rgba(0,0,0,0.28)" }}
        >
          3D 시뮬레이션
        </button>
        <button
          onClick={() => setDriveView(true)}
          disabled={!routePoints.length}
          style={{ border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 14px", cursor: routePoints.length ? "pointer" : "not-allowed", color: "#fff", fontWeight: 800, opacity: routePoints.length ? 1 : 0.45, background: driveView ? "#22c55e" : "rgba(15,23,42,0.82)", boxShadow: "0 8px 20px rgba(0,0,0,0.28)" }}
        >
          주행뷰
        </button>
        {start && end && (
          <button
            onClick={restartRouteAnimation}
            disabled={!routePoints.length}
            style={{ border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "9px 14px", cursor: routePoints.length ? "pointer" : "not-allowed", color: "#fff", fontWeight: 800, opacity: routePoints.length ? 1 : 0.45, background: simulationCompleted ? "#f59e0b" : "rgba(15,23,42,0.82)", boxShadow: "0 8px 20px rgba(0,0,0,0.28)" }}
          >
            다시 실행
          </button>
        )}
      </div>

      {start && !end && (
        <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 10, padding: "8px 14px", borderRadius: 999, background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.4)", color: "#bbf7d0", fontSize: 12, fontWeight: 800 }}>
          출발지 선택됨: {start.intNm} · 목적지를 클릭하세요
        </div>
      )}

      {start && end && (
        <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 10, padding: "8px 14px", borderRadius: 999, background: isOptimized ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.13)", border: `1px solid ${isOptimized ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.4)"}`, color: isOptimized ? "#bbf7d0" : "#fecaca", fontSize: 12, fontWeight: 800 }}>
          {simulationCompleted ? "시뮬레이션 완료 · 목적지 정지" : isOptimized ? "신호제어 적용 중 · 실시간 속도 재수집 기준" : "현행 운영 · 실시간 속도 기준"}
          {viaCrossroads.length > 0 ? ` · 자동 경유 ${viaCrossroads.length}개` : ""}
        </div>
      )}
    </div>
  );
}
