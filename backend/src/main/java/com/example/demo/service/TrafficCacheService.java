package com.example.demo.service;

import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.TrafficStatus;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

// 교차로 정보 및 신호 데이터를 메모리에 캐싱 (PoC용, 추후 Redis로 교체)
@Service
// - 교차로ID → 교차로 정보
public class TrafficCacheService {

    // 현재 모니터링 중심 좌표 (구 클릭 시 업데이트)
    private volatile double centerLat;
    private volatile double centerLon;
    private volatile double centerRadius = 1.0;
    // 구역 선택 API가 V2X+보조 데이터를 한 번에 준비하는 동안 정기 폴링이 중간 데이터를 덮어쓰지 않도록 막는다.
    private final AtomicBoolean areaRefreshInProgress = new AtomicBoolean(false);

    // 교차로ID → 교차로 정보
    public void setCenter(double lat, double lon, double radius) {
        this.centerLat = lat;
        this.centerLon = lon;
        this.centerRadius = radius;
    }

    public double getCenterLat() { return centerLat; }
    public double getCenterLon() { return centerLon; }
    public double getCenterRadius() { return centerRadius; }

    public boolean beginAreaRefresh() {
        return areaRefreshInProgress.compareAndSet(false, true);
    }

    public void finishAreaRefresh() {
        areaRefreshInProgress.set(false);
    }

    public boolean isAreaRefreshInProgress() {
        return areaRefreshInProgress.get();
    }

    // 교차로ID → 최신 신호 상태 (volatile로 참조 자체를 원자적으로 교체)
    private volatile Map<String, TrafficStatus> signalCache = new ConcurrentHashMap<>();

    // 업데이트 메서드 (API 호출 후 교차로ID별로 신호 상태 업데이트) -->구 클릭했을때
    public void updateSignal(String crsrdId, TrafficStatus status) {
        signalCache.put(crsrdId, status);
    }

    // 전체 업데이트 메서드: 새 맵을 생성해 참조를 원자적으로 교체 → clear()+putAll() 의 부분 읽기 문제 제거
    // 추가로, 새 데이터에서 신호가 비어 있으면(V2X 빈/부분 응답·스켈레톤) 직전 캐시의 마지막 신호를
    // 같은 crsrdId 기준으로 유지(stale 보존)한다. 폴링·구역선택·속도 broadcast 등 모든 캐시 갱신 경로에서
    // 신호등이 화면에서 사라지는 것을 막는다. (구를 바꾸면 crsrdId가 달라 보존이 일어나지 않으므로 오염 없음)
    public void updateAllSignals(Map<String, TrafficStatus> statusMap) {
        if (statusMap != null) {
            Map<String, TrafficStatus> previous = signalCache;
            if (previous != null && !previous.isEmpty()) {
                for (Map.Entry<String, TrafficStatus> entry : statusMap.entrySet()) {
                    TrafficStatus fresh = entry.getValue();
                    if (fresh == null) continue;
                    Map<String, com.example.demo.model.SignalDirection> sig = fresh.getSignals();
                    if (sig != null && !sig.isEmpty()) continue;   // 새 신호가 있으면 그대로 사용
                    TrafficStatus old = previous.get(entry.getKey());
                    if (old == null || old.getSignals() == null || old.getSignals().isEmpty()) continue;
                    fresh.setSignals(old.getSignals());            // 직전 신호 유지 (제자리 갱신 → broadcast에도 반영)
                    fresh.setTotDt(old.getTotDt());
                }
            }
        }
        signalCache = new ConcurrentHashMap<>(statusMap);
    }

    // 조회 메서드 (교차로ID로 신호 상태 조회, 캐시에 없으면 null 반환) --> 챗봇이 답변 생성할 때 그 교차로ID에 해당하는 신호 상태 가져올 때
    public TrafficStatus getSignal(String crsrdId) {
        return signalCache.get(crsrdId);
    }

    // 보조 데이터 매핑에서 현재 신호 캐시에 들어온 교차로 목록이 필요할 때 사용한다.
    public List<CrossroadInfo> getCrossroads() {
        return signalCache.values().stream()
                .map(this::toCrossroadInfo)
                .toList();
    }

    public Map<String, TrafficStatus> getAllSignals() {
        return Collections.unmodifiableMap(signalCache);
    }

    private CrossroadInfo toCrossroadInfo(TrafficStatus status) {
        CrossroadInfo crossroad = new CrossroadInfo();
        crossroad.setCrsrdId(status.getCrsrdId());
        crossroad.setCrsrdNm(status.getCrsrdNm());
        crossroad.setLat(status.getLat());
        crossroad.setLon(status.getLon());
        crossroad.setGuName(status.getGuName());
        return crossroad;
    }
}
