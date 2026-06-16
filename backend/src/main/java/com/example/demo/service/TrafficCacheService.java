package com.example.demo.service;

import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.TrafficStatus;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import lombok.extern.slf4j.Slf4j;

// 교차로 정보 및 신호 데이터를 메모리에 캐싱 (PoC용, 추후 Redis로 교체)
@Slf4j
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

    // 구를 바꾸면(=캐시 교체) signalCache는 새 구로 갈리지만, 이 맵은 지금까지 본 모든 교차로의
    // 마지막 "실제 신호"를 crsrdId로 영구 보관한다. 구를 오가도·V2X가 빈 응답을 줘도 한 번 본 신호는 복원된다.
    // (crsrdId가 키라 구가 달라도 섞이지 않음. 서버 재시작 시에는 비워짐 — 메모리 보관)
    private final Map<String, TrafficStatus> lastKnownSignals = new ConcurrentHashMap<>();

    // 전체 업데이트 메서드: 새 맵을 생성해 참조를 원자적으로 교체 → clear()+putAll() 의 부분 읽기 문제 제거
    // 갱신 시 ① 실제 신호는 영구 보관소에 기록하고 ② 빈 신호는 영구 보관소의 마지막 값으로 채운다.
    // 폴링·구역선택·속도 broadcast 등 모든 캐시 갱신 경로에서 신호등이 화면에서 사라지는 것을 막는다.
    public void updateAllSignals(Map<String, TrafficStatus> statusMap) {
        if (statusMap != null) {
            recordLastKnown(statusMap);   // 새로 들어온 실제 신호를 영구 보관소에 저장
            fillStaleSignals(statusMap);  // 빈 신호는 영구 보관소의 마지막 값으로 채움(구 무관)
        }
        signalCache = new ConcurrentHashMap<>(statusMap);
    }

    // 새 데이터에서 신호가 비어 있으면 영구 보관소(lastKnownSignals)의 같은 crsrdId 마지막 신호로 채운다.
    // 제자리(in-place) 갱신이라 이 맵을 그대로 broadcast하는 경로(MapController 등)에도 반영된다.
    // enrich 전에 호출해야 avgWait/혼잡도 계산도 정확하므로 폴링에서 별도로 한 번 더 호출한다.
    public void fillStaleSignals(Map<String, TrafficStatus> statusMap) {
        if (statusMap == null || lastKnownSignals.isEmpty()) return;
        int filled = 0;
        for (Map.Entry<String, TrafficStatus> entry : statusMap.entrySet()) {
            TrafficStatus fresh = entry.getValue();
            if (fresh == null) continue;
            Map<String, com.example.demo.model.SignalDirection> sig = fresh.getSignals();
            if (sig != null && !sig.isEmpty()) continue;   // 새 신호가 있으면 그대로 사용
            TrafficStatus known = lastKnownSignals.get(entry.getKey());
            if (known == null || known.getSignals() == null || known.getSignals().isEmpty()) continue;
            fresh.setSignals(known.getSignals());
            fresh.setTotDt(known.getTotDt());
            filled++;
        }
        if (filled > 0) {
            log.info("신호 영구보존: 빈 신호 {}개를 마지막 신호로 복원", filled);
        }
    }

    // 실제 신호가 있는 상태만 영구 보관소에 저장(빈 신호는 저장 안 함 → 옛 값을 덮어쓰지 않음).
    private void recordLastKnown(Map<String, TrafficStatus> statusMap) {
        for (Map.Entry<String, TrafficStatus> entry : statusMap.entrySet()) {
            TrafficStatus s = entry.getValue();
            if (s == null) continue;
            Map<String, com.example.demo.model.SignalDirection> sig = s.getSignals();
            if (sig == null || sig.isEmpty()) continue;
            lastKnownSignals.put(entry.getKey(), s);
        }
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
