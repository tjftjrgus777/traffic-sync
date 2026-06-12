// 경로 계산, 속도/혼잡도 분석 유틸리티
import { distanceMeters, metersToDegrees, perpendicularDistanceToSegmentMeters, routeBearingDeg, angleDiffDeg } from "./geoUtils";

export function routeLengthMeters(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distanceMeters(points[i], points[i + 1]);
  return total;
}

// 경로 상의 특정 progress(0~1) 위치 좌표 보간
export function interpolateRoute(points, progress) {
  if (!points?.length) return null;
  if (points.length === 1) return points[0];
  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = distanceMeters(points[i], points[i + 1]);
    segments.push({ from: points[i], to: points[i + 1], len });
    total += len;
  }
  if (total <= 0) return points[0];
  let target = Math.max(0, Math.min(1, progress)) * total;
  for (const seg of segments) {
    if (target <= seg.len) {
      const t = seg.len === 0 ? 0 : target / seg.len;
      return { lon: seg.from.lon + (seg.to.lon - seg.from.lon) * t, lat: seg.from.lat + (seg.to.lat - seg.from.lat) * t };
    }
    target -= seg.len;
  }
  return points[points.length - 1];
}


// 혼잡도 문자열 정규화
export function normalizeCongestion(value) {
  const text = String(value || "").trim();
  if (!text) return "정보없음";
  if (text.includes("정체") || text.includes("혼잡")) return "정체";
  if (text.includes("서행")) return "서행";
  if (text.includes("원활") || text.includes("원할")) return "원활";
  return text;
}

export function getDirectionalSpeedKph(segment, directionKey) {
  const n = Number(segment?.[directionKey]?.speedKph);
  return Number.isFinite(n) ? n : null;
}

export function getDirectionalCongestion(segment, directionKey) {
  const direct = normalizeCongestion(segment?.[directionKey]?.congestion);
  if (direct !== "정보없음" && direct !== "알 수 없음") return direct;
  const speed = getDirectionalSpeedKph(segment, directionKey);
  if (speed == null) return "정보없음";
  if (speed < 15) return "정체";
  if (speed < 25) return "서행";
  return "원활";
}

// 백엔드 selectedTraffic 우선, 없으면 up → down 순으로 사용
export function getSelectedTraffic(segment) {
  return segment?.selectedTraffic ?? segment?.up ?? segment?.down ?? null;
}

export function getSegmentSpeedKph(segment) {
  const selected = Number(getSelectedTraffic(segment)?.speedKph);
  if (Number.isFinite(selected)) return selected;
  const speeds = [segment?.selectedTraffic?.speedKph, segment?.up?.speedKph, segment?.down?.speedKph]
    .map(Number).filter(Number.isFinite);
  return speeds.length ? Math.min(...speeds) : null;
}

export function getSegmentCongestion(segment) {
  const selected = normalizeCongestion(getSelectedTraffic(segment)?.congestion);
  if (selected !== "정보없음" && selected !== "알 수 없음") return selected;
  const speed = getSegmentSpeedKph(segment);
  if (speed == null) return "정보없음";
  if (speed < 15) return "정체";
  if (speed < 25) return "서행";
  return "원활";
}

export function getCongestionColor(congestion) {
  const normalized = normalizeCongestion(congestion);
  if (normalized === "정체") return "#ff2d2d";
  if (normalized === "서행") return "#ffb020";
  if (normalized === "원활") return "#34d399";
  return "#94a3b8";
}

export function getRouteTrafficSegments(routeTraffic) {
  return Array.isArray(routeTraffic?.segments) ? routeTraffic.segments : [];
}

// 진행 방향(상행/하행) 키 판단
export function getSelectedDirectionKey(segment, routeTraffic = null) {
  const travelDir = String(segment?.travelDir || routeTraffic?.requestedTravelDir || "").trim();
  if (travelDir === "상행" || travelDir.toLowerCase() === "up") return "up";
  if (travelDir === "하행" || travelDir.toLowerCase() === "down") return "down";
  const selectedLinkId = segment?.selectedTraffic?.linkId;
  if (selectedLinkId && segment?.down?.linkId && String(selectedLinkId) === String(segment.down.linkId)) return "down";
  if (selectedLinkId && segment?.up?.linkId && String(selectedLinkId) === String(segment.up.linkId)) return "up";
  return "up";
}

// 출발지→목적지 방위각으로 상행/하행 판단
export function calculateRouteTravelDir(routeNodes) {
  if (!Array.isArray(routeNodes) || routeNodes.length < 2) return null;
  const first = routeNodes[0];
  const last = routeNodes[routeNodes.length - 1];
  if (!Number.isFinite(first?.lat) || !Number.isFinite(last?.lat)) return null;
  const bearing = routeBearingDeg({ lat: first.lat, lon: first.lon }, { lat: last.lat, lon: last.lon });
  return bearing >= 315 || bearing < 135 ? "상행" : "하행";
}

export function getSpeedAtProgress(routeTraffic, progress) {
  const segments = getRouteTrafficSegments(routeTraffic);
  if (!segments.length) return null;
  const idx = Math.max(0, Math.min(segments.length - 1, Math.floor(Math.max(0, Math.min(0.999999, progress)) * segments.length)));
  return getSegmentSpeedKph(segments[idx]);
}

export function estimateTripFromTraffic(routePoints, routeTraffic) {
  const distance = routeLengthMeters(routePoints);
  const segments = getRouteTrafficSegments(routeTraffic);
  if (!distance || !segments.length) return null;

  let speedCount = 0;
  let minSpeedKph = null, missingSpeedCount = 0, bottleneckCount = 0;

  segments.forEach(segment => {
    const speed = getSegmentSpeedKph(segment);
    const congestion = getSegmentCongestion(segment);
    if (congestion === "정체") bottleneckCount++;
    if (speed == null || speed <= 0) { missingSpeedCount++; return; }
    speedCount++;
    minSpeedKph = minSpeedKph == null ? speed : Math.min(minSpeedKph, speed);
  });

  return {
    distance,
    minSpeedKph: minSpeedKph == null ? null : Math.round(minSpeedKph),
    bottleneckCount,
    speedMissing: missingSpeedCount > 0,
    realTimeSpeed: speedCount > 0,
    segmentsCount: segments.length,
  };
}

// 교차로 노드 그래프로 최적 경로 탐색 (다익스트라)
export function buildMarkerGraphRoute(startCr, endCr, crossroads, totalDist, getCrLonLat) {
  const edgeLimits = [220, 320, 450, 600];
  for (const maxEdgeMeters of edgeLimits) {
    const route = tryBuildMarkerGraphRoute(startCr, endCr, crossroads, totalDist, maxEdgeMeters, getCrLonLat);
    if (route.points.length >= 2 && route.viaCrossroads.length > 0) return route;
  }
  return { points: [], viaCrossroads: [] };
}

export function tryBuildMarkerGraphRoute(startCr, endCr, crossroads, totalDist, maxEdgeMeters, getCrLonLat) {
  const start = getCrLonLat(startCr);
  const end = getCrLonLat(endCr);
  if (!start || !end) return { points: [], viaCrossroads: [] };

  const maxNodeCount = 1200;
  const neighborLimit = 24;
  const detourLimit = Math.max(totalDist * 8, totalDist + 3500);
  const bboxPad = metersToDegrees(Math.max(800, totalDist * 0.95), (start.lat + end.lat) / 2);

  const minLon = Math.min(start.lon, end.lon) - bboxPad.lon;
  const maxLon = Math.max(start.lon, end.lon) + bboxPad.lon;
  const minLat = Math.min(start.lat, end.lat) - bboxPad.lat;
  const maxLat = Math.max(start.lat, end.lat) + bboxPad.lat;

  const startNode = { key: `start-${startCr.intNo}`, cr: startCr, ll: start, kind: "start", projected: { distance: 0, progress: 0 }, detour: totalDist };
  const endNode = { key: `end-${endCr.intNo}`, cr: endCr, ll: end, kind: "end", projected: { distance: 0, progress: 1 }, detour: totalDist };

  const middleNodes = crossroads
    .filter(cr => cr.intNo !== startCr?.intNo && cr.intNo !== endCr?.intNo)
    .map(cr => {
      const ll = getCrLonLat(cr);
      if (!ll) return null;
      if (ll.lon < minLon || ll.lon > maxLon || ll.lat < minLat || ll.lat > maxLat) return null;
      const fromStart = distanceMeters(start, ll);
      const toEnd = distanceMeters(ll, end);
      const detour = fromStart + toEnd;
      if (detour > detourLimit) return null;
      const projected = perpendicularDistanceToSegmentMeters(ll, start, end);
      const score = Math.max(0, detour - totalDist) * 0.18 + projected.distance * 0.28 + Math.abs(projected.progress - 0.5) * 4;
      return { key: `cr-${cr.intNo}`, cr, ll, kind: "via", fromStart, toEnd, detour, projected, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, maxNodeCount);

  const nodes = [startNode, ...middleNodes, endNode];
  const endIndex = nodes.length - 1;
  const edges = Array.from({ length: nodes.length }, () => []);

  for (let i = 0; i < nodes.length; i++) {
    const current = nodes[i];
    const candidates = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || j === 0) continue;
      const next = nodes[j];
      const d = distanceMeters(current.ll, next.ll);
      if (d > maxEdgeMeters) continue;
      if (i === 0 && j === endIndex && middleNodes.length > 0 && totalDist > maxEdgeMeters * 0.9) continue;
      if (j === endIndex && i !== 0 && d > maxEdgeMeters * 0.9) continue;
      const nextToEnd = distanceMeters(next.ll, end);
      const currentToEnd = distanceMeters(current.ll, end);
      if (j !== endIndex && i !== 0 && nextToEnd > currentToEnd + maxEdgeMeters * 2.8) continue;

      const bearingPenalty = (i === 0 || j === endIndex) ? 0
        : angleDiffDeg(routeBearingDeg(current.ll, end), routeBearingDeg(current.ll, next.ll)) * 0.2;

      candidates.push({
        to: j,
        weight: d + Math.max(0, d - 90) * 7
          + Math.max(0, (next.detour ?? totalDist) - totalDist) * 0.04
          + (next.projected?.distance ?? 0) * 0.01
          + (current.projected && next.projected ? Math.max(0, current.projected.progress - next.projected.progress) * 80 : 0)
          + bearingPenalty,
      });
    }
    candidates.sort((a, b) => a.weight - b.weight);
    edges[i] = candidates.slice(0, neighborLimit);
  }

  const dist = Array(nodes.length).fill(Infinity);
  const prev = Array(nodes.length).fill(-1);
  const visited = Array(nodes.length).fill(false);
  dist[0] = 0;

  for (let step = 0; step < nodes.length; step++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; }
    }
    if (u === -1 || u === endIndex) break;
    visited[u] = true;
    for (const edge of edges[u]) {
      const alt = dist[u] + edge.weight;
      if (alt < dist[edge.to]) { dist[edge.to] = alt; prev[edge.to] = u; }
    }
  }

  if (!Number.isFinite(dist[endIndex]) || prev[endIndex] === -1) return { points: [], viaCrossroads: [] };

  const pathIndexes = [];
  let cur = endIndex;
  while (cur !== -1) { pathIndexes.push(cur); cur = prev[cur]; }
  pathIndexes.reverse();
  if (pathIndexes.length <= 2) return { points: [], viaCrossroads: [] };

  const pathNodes = pathIndexes.map(idx => nodes[idx]);
  const points = pathNodes.map(n => n.ll);
  const routeTotal = routeLengthMeters(points) || totalDist;
  let acc = 0;
  const viaCrossroads = [];
  for (let i = 1; i < pathNodes.length - 1; i++) {
    acc += distanceMeters(points[i - 1], points[i]);
    viaCrossroads.push({ ...pathNodes[i].cr, routeProgress: acc / routeTotal, routeDistanceMeters: Math.round(distanceMeters(points[i - 1], points[i])) });
  }

  return { points, viaCrossroads };
}
