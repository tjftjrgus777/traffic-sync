// Canvas 기반 마커/라벨/신호등 이미지 생성 유틸리티
import { distanceMeters, lonLatToLocalMeters } from "./geoUtils";
import { normalizeCongestion, getCongestionColor } from "./routeUtils";

export function createMarkerCanvas(color, size = 12, text = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, 72, 72);

  ctx.beginPath();
  ctx.arc(36, 34, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();

  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(36, 34, size + 4, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (text) {
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(9, size - 2)}px Malgun Gothic`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 36, 34);
  }

  return canvas.toDataURL();
}

export function createSignalCanvas(isRed) {
  const canvas = document.createElement("canvas");
  canvas.width = 60;
  canvas.height = 60;

  const ctx = canvas.getContext("2d");
  const color = isRed ? "#ef4444" : "#22c55e";

  ctx.clearRect(0, 0, 60, 60);

  // 바깥 글로우
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;

  // 메인 원형 마커
  ctx.beginPath();
  ctx.arc(30, 30, 22, 0, Math.PI * 2);
  ctx.fillStyle = isRed
    ? "rgba(239,68,68,0.92)"
    : "rgba(34,197,94,0.92)";
  ctx.fill();

  ctx.shadowBlur = 0;

  // 테두리
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 중앙 하이라이트
  ctx.beginPath();
  ctx.arc(30, 30, 9, 0, Math.PI * 2);
  ctx.fillStyle = isRed
    ? "rgba(255,205,205,0.72)"
    : "rgba(220,255,230,0.72)";
  ctx.fill();

  return canvas.toDataURL();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function createDirectionalSpeedLabelCanvas(directionLabel, speedKph, congestion, axisName = "") {
  const normalized = normalizeCongestion(congestion);
  const isBottleneck = normalized === "정체";
  const canvas = document.createElement("canvas");

  canvas.width = isBottleneck ? 276 : 248;
  canvas.height = isBottleneck ? 132 : 92;

  const ctx = canvas.getContext("2d");
  const color = getCongestionColor(congestion);
  const speedText = speedKph == null ? "수집 중" : `${(() => { const v = Math.round(speedKph * 10) / 10; return v % 1 === 0 ? v : v.toFixed(1); })()}km/h`;
  const roadText = axisName ? String(axisName).slice(0, 8) : "";

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.shadowColor = color;
  ctx.shadowBlur = isBottleneck ? 20 : 12;

  roundRect(ctx, 10, 10, canvas.width - 20, canvas.height - 22, isBottleneck ? 14 : 12);
  ctx.fillStyle = isBottleneck ? "rgba(69,10,10,0.97)" : "rgba(3,7,18,0.96)";
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = isBottleneck ? 5 : 4;
  ctx.strokeStyle = color;

  roundRect(ctx, 10, 10, canvas.width - 20, canvas.height - 22, isBottleneck ? 14 : 12);
  ctx.stroke();

  if (isBottleneck) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, 24, 22, canvas.width - 48, 30, 8);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px Malgun Gothic";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🚨 병목지", canvas.width / 2, 38);

    ctx.font = "bold 28px Malgun Gothic";
    ctx.fillText(speedText, canvas.width / 2, 78);

    ctx.fillStyle = "#fecaca";
    ctx.font = "bold 15px Malgun Gothic";
    ctx.fillText(
      roadText ? `${directionLabel} · ${roadText}` : directionLabel,
      canvas.width / 2,
      105
    );

    return canvas.toDataURL();
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(34, 42, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Malgun Gothic";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(speedText, 50, 35);

  ctx.fillStyle = color;
  ctx.font = "bold 14px Malgun Gothic";
  ctx.fillText(`${directionLabel} · ${normalized}`, 50, 59);

  if (roadText) {
    ctx.fillStyle = "rgba(226,232,240,0.78)";
    ctx.font = "12px Malgun Gothic";
    ctx.fillText(roadText, 50, 76);
  }

  return canvas.toDataURL();
}

export function createSpeedLabelCanvas(speedKph, congestion, axisName = "") {
  const normalized = normalizeCongestion(congestion);
  const canvas = document.createElement("canvas");

  canvas.width = 200;
  canvas.height = 72;

  const ctx = canvas.getContext("2d");
  const color = getCongestionColor(congestion);
  const speedText = speedKph == null ? "수집 중" : `${(() => { const v = Math.round(speedKph * 10) / 10; return v % 1 === 0 ? v : v.toFixed(1); })()}km/h`;
  const roadText = axisName ? String(axisName).slice(0, 8) : "";

  ctx.clearRect(0, 0, 200, 72);

  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  roundRect(ctx, 8, 8, 184, 56, 10);
  ctx.fillStyle = "rgba(3,7,18,0.96)";
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;

  roundRect(ctx, 8, 8, 184, 56, 10);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(28, 36, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px Malgun Gothic";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(speedText, 42, 28);

  ctx.fillStyle = color;
  ctx.font = "bold 12px Malgun Gothic";
  ctx.fillText(normalized, 42, 48);

  if (roadText) {
    ctx.fillStyle = "rgba(226,232,240,0.6)";
    ctx.font = "11px Malgun Gothic";
    ctx.fillText(roadText, 42, 62);
  }

  return canvas.toDataURL();
}

// 차량 위치와 교통링크 상하행 폴리라인 거리 계산 → 방향 판단
export function distanceToPolylineMeters(point, vertices) {
  if (!point || !vertices?.length) return Infinity;
  if (vertices.length === 1) return distanceMeters(point, vertices[0]);

  let minDistance = Infinity;

  for (let i = 0; i < vertices.length - 1; i++) {
    const start = vertices[i];
    const end = vertices[i + 1];

    if (!start || !end) continue;

    const originLat = (start.lat + end.lat) / 2;
    const p = lonLatToLocalMeters(point, originLat);
    const a = lonLatToLocalMeters(start, originLat);
    const b = lonLatToLocalMeters(end, originLat);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;

    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)
    );

    minDistance = Math.min(
      minDistance,
      Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
    );
  }

  return minDistance;
}

export function mapCarToTrafficDirection(carPos, segment) {
  if (!carPos || !segment) return null;

  const upDistance = distanceToPolylineMeters(carPos, segment.up?.vertices);
  const downDistance = distanceToPolylineMeters(carPos, segment.down?.vertices);

  if (!Number.isFinite(upDistance) && !Number.isFinite(downDistance)) return null;

  const direction = upDistance <= downDistance ? "up" : "down";

  return {
    direction,
    traffic: segment[direction],
    distanceMeters: direction === "up" ? upDistance : downDistance,
    upDistanceMeters: upDistance,
    downDistanceMeters: downDistance,
  };
}