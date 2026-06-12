import { useState, useEffect, useRef } from "react";
import { mapKeys } from "../utils/signalUtils";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

function normalizeTrafficStatuses(list) {
  return list.map(s => {
    const ms = mapKeys(s.signals);
    // 속도/위험도/혼잡도는 더 이상 프론트에서 더미로 만들지 않는다.
    // 백엔드 TrafficStatus에 합쳐진 실제 API 값만 기존 UI 필드명으로 매핑한다.
    const speed = s.speedKph == null ? null : Math.round(s.speedKph * 10) / 10;
    // 방향별 진입 속도: 키를 nt/et/... → north/east/... 로 변환하고 소수점 1자리로 정규화.
    const speedByDirection = s.speedKphByDirection
      ? Object.fromEntries(
          Object.entries(mapKeys(s.speedKphByDirection))
            .map(([k, v]) => [k, v == null ? null : Math.round(v * 10) / 10])
        )
      : null;
    const riskIndex = s.riskIndex == null ? null : Number(s.riskIndex);
    const fallbackRiskScore = s.riskScore == null ? null : Number(s.riskScore);
    const riskScoreSource = Number.isFinite(riskIndex) ? riskIndex : fallbackRiskScore;
    const riskScore = Number.isFinite(riskScoreSource) ? riskScoreSource : null;
    const riskGrade = s.riskGrade == null ? null : String(s.riskGrade).trim();
    const congestion = s.congestion ?? "알 수 없음";
    const avgWait = s.avgWaitSec ?? null;
    return { ...s, mappedSignals: ms, speedByDirection, riskIndex, riskGrade, riskScore, congestion, speed, avgWait };
  });
}

export function useWebSocket(setWsData) {
  const [wsStatus, setWsStatus] = useState("연결 중...");
  const [lastUpdate, setLastUpdate] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    const WS = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:8080/ws/traffic`;
    let reconnectTimer = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      if (wsRef.current && wsRef.current.readyState < 2) {
        wsRef.current.close();
      }

      const ws = new WebSocket(WS);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) return;
        setWsStatus("연결됨");

        // 새로고침 직후에는 다음 WebSocket 브로드캐스트까지 화면이 비어 있을 수 있어 현재 캐시를 먼저 읽는다.
        fetch(`${API_BASE}/api/signals`)
          .then(res => res.ok ? res.json() : [])
          .then(list => {
            if (!destroyed && Array.isArray(list) && list.length > 0) {
              setWsData(normalizeTrafficStatuses(list));
              setLastUpdate(new Date());
            }
          })
          .catch(err => console.error("초기 신호 데이터 로드 실패:", err));
      };

      ws.onmessage = e => {
        if (destroyed) return;
        try {
          const list = JSON.parse(e.data);
          setWsData(normalizeTrafficStatuses(list));
          setLastUpdate(new Date());
        } catch (err) {
          console.error("WS 파싱:", err);
        }
      };

      ws.onclose = () => {
        if (destroyed) return;
        setWsStatus("재연결 중...");
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => { if (!destroyed) setWsStatus("연결 오류"); };
    }

    connect();
    return () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  return { wsStatus, lastUpdate };
}
