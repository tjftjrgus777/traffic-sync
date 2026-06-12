package com.example.demo.service;

import com.example.demo.model.SignalDirection;
import com.example.demo.model.TrafficStatus;
import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.model.context.RoadRiskSnapshot;
import com.example.demo.model.context.RoadSpeedSnapshot;
import com.example.demo.model.context.WeatherSnapshot;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class SupplementalDataCacheService {

    private volatile WeatherSnapshot weather;
    private final ConcurrentHashMap<String, CrossroadRoadLinkMapping> mappingsByCrossroadId = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Map<String, CrossroadRoadLinkMapping>> directionalMappingsByCrossroadId =
            new ConcurrentHashMap<>();
    private final Set<String> managedTrafficLinkIds = ConcurrentHashMap.newKeySet();
    private final ConcurrentHashMap<String, RoadSpeedSnapshot> speedsByLinkId = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, RoadRiskSnapshot> risksByLinkId = new ConcurrentHashMap<>();

    public Optional<WeatherSnapshot> getWeather() {
        return Optional.ofNullable(weather);
    }

    public void updateWeather(WeatherSnapshot snapshot) {
        this.weather = snapshot;
    }

    public void markWeatherStale() {
        if (weather != null) {
            weather.setStale(true);
        }
    }

    public void updateMappings(Map<String, CrossroadRoadLinkMapping> mappings) {
        mappingsByCrossroadId.clear();
        if (mappings != null) {
            mappingsByCrossroadId.putAll(mappings);
        }
    }

    // 구역을 새로 선택하면 이전 구역의 도로 링크/속도/위험도 값이 섞이지 않도록 비운다.
    public void clearRoadSupplementalData() {
        mappingsByCrossroadId.clear();
        directionalMappingsByCrossroadId.clear();
        managedTrafficLinkIds.clear();
        speedsByLinkId.clear();
    }

    public Optional<CrossroadRoadLinkMapping> getMapping(String crsrdId) {
        return Optional.ofNullable(mappingsByCrossroadId.get(crsrdId));
    }

    public void updateDirectionalMappings(Map<String, Map<String, CrossroadRoadLinkMapping>> mappings) {
        directionalMappingsByCrossroadId.clear();
        if (mappings == null) {
            return;
        }
        mappings.forEach((crsrdId, byDirection) -> {
            if (byDirection != null) {
                directionalMappingsByCrossroadId.put(
                        crsrdId,
                        Collections.unmodifiableMap(new LinkedHashMap<>(byDirection))
                );
            }
        });
    }

    public Map<String, CrossroadRoadLinkMapping> getDirectionalMappings(String crsrdId) {
        return directionalMappingsByCrossroadId.getOrDefault(crsrdId, Collections.emptyMap());
    }

    public Collection<CrossroadRoadLinkMapping> getMappings() {
        return Collections.unmodifiableCollection(mappingsByCrossroadId.values());
    }

    public Collection<CrossroadRoadLinkMapping> getAllMappedLinkMappings() {
        Map<String, CrossroadRoadLinkMapping> uniqueByLinkId = new LinkedHashMap<>();
        mappingsByCrossroadId.values().forEach(mapping -> putMappingByLinkId(uniqueByLinkId, mapping));
        directionalMappingsByCrossroadId.values().forEach(byDirection ->
                byDirection.values().forEach(mapping -> putMappingByLinkId(uniqueByLinkId, mapping)));
        return Collections.unmodifiableCollection(uniqueByLinkId.values());
    }

    public Set<String> getMappedLinkIds() {
        Set<String> linkIds = getAllMappedLinkMappings().stream()
                .map(CrossroadRoadLinkMapping::getLinkId)
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .collect(Collectors.toUnmodifiableSet());
        if (managedTrafficLinkIds.isEmpty()) {
            return linkIds;
        }
        Set<String> merged = ConcurrentHashMap.newKeySet();
        merged.addAll(linkIds);
        merged.addAll(managedTrafficLinkIds);
        return Collections.unmodifiableSet(merged);
    }

    public void updateManagedTrafficLinkIds(Collection<String> linkIds) {
        managedTrafficLinkIds.clear();
        if (linkIds == null) {
            return;
        }
        linkIds.stream()
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .forEach(managedTrafficLinkIds::add);
    }

    private void putMappingByLinkId(Map<String, CrossroadRoadLinkMapping> mappings, CrossroadRoadLinkMapping mapping) {
        if (mapping == null || mapping.getLinkId() == null || mapping.getLinkId().isBlank()) {
            return;
        }
        mappings.putIfAbsent(mapping.getLinkId(), mapping);
    }

    public void updateSpeed(RoadSpeedSnapshot snapshot) {
        speedsByLinkId.put(snapshot.getLinkId(), snapshot);
    }

    public Optional<RoadSpeedSnapshot> getSpeed(String linkId) {
        return Optional.ofNullable(speedsByLinkId.get(linkId));
    }

    public void markSpeedsStale() {
        speedsByLinkId.values().forEach(speed -> speed.setStale(true));
    }

    public void updateRisk(String linkId, RoadRiskSnapshot snapshot) {
        risksByLinkId.put(linkId, snapshot);
    }

    public Optional<RoadRiskSnapshot> getRisk(String linkId) {
        return Optional.ofNullable(risksByLinkId.get(linkId));
    }

    public void markRisksStale() {
        risksByLinkId.values().forEach(risk -> risk.setStale(true));
    }

    public void markRiskStale(String linkId) {
        if (linkId == null || linkId.isBlank()) {
            return;
        }
        RoadRiskSnapshot risk = risksByLinkId.get(linkId);
        if (risk != null) {
            risk.setStale(true);
        }
    }

    // V2X 신호만 들어 있는 TrafficStatus에 실제 보조 API 값을 합쳐서
    // 프론트와 챗봇이 같은 "현재 교차로 상태"를 보도록 만든다.
    public Map<String, TrafficStatus> enrichTrafficStatuses(Map<String, TrafficStatus> statuses) {
        if (statuses == null) {
            return Collections.emptyMap();
        }
        statuses.values().forEach(this::enrichTrafficStatus);
        return statuses;
    }

    public TrafficStatus enrichTrafficStatus(TrafficStatus status) {
        if (status == null) {
            return null;
        }

        status.setWeather(getWeather().orElse(null));
        status.setAvgWaitSec(calculateAverageWaitSec(status.getSignals()));

        CrossroadRoadLinkMapping mapping = getMapping(status.getCrsrdId()).orElse(null);
        RoadSpeedSnapshot speed = speedLinkId(mapping)
                .flatMap(this::getSpeed)
                .orElse(null);
        RoadRiskSnapshot risk = riskCacheKey(mapping)
                .flatMap(this::getRisk)
                .orElse(null);

        applySpeed(status, speed);
        applyDirectionalSpeeds(status);
        applyRisk(status, risk);

        // 속도 API가 아직 없으면 신호 잔여시간으로만 임시 혼잡도를 계산한다.
        // 랜덤값은 사용하지 않기 때문에 실제 데이터가 없을 때는 stale 플래그로 구분할 수 있다.
        status.setCongestion(calculateCongestion(status.getSpeedKph(), status.getSignals()));
        return status;
    }

    private void applySpeed(TrafficStatus status, RoadSpeedSnapshot speed) {
        if (speed == null) {
            status.setSpeedKph(null);
            status.setTravelTimeSec(null);
            status.setSpeedStale(true);
            return;
        }

        status.setSpeedKph(speed.getSpeedKph());
        status.setTravelTimeSec(speed.getTravelTimeSec());
        status.setSpeedStale(speed.isStale());
    }

    // 방향별 진입 링크 → 속도 캐시를 조회해 speedKphByDirection을 채운다.
    // 방향별 속도가 하나라도 있으면 대표 speedKph는 그 중 최저(가장 막힌 진입)로 덮어쓴다.
    private void applyDirectionalSpeeds(TrafficStatus status) {
        Map<String, CrossroadRoadLinkMapping> directional = getDirectionalMappings(status.getCrsrdId());
        if (directional.isEmpty()) {
            status.setSpeedKphByDirection(null);
            return;
        }

        Map<String, Double> speedByDirection = new LinkedHashMap<>();
        boolean anyFresh = false;
        for (Map.Entry<String, CrossroadRoadLinkMapping> entry : directional.entrySet()) {
            RoadSpeedSnapshot snapshot = speedLinkId(entry.getValue()).flatMap(this::getSpeed).orElse(null);
            if (snapshot == null || snapshot.getSpeedKph() == null) {
                continue;
            }
            speedByDirection.put(entry.getKey(), snapshot.getSpeedKph());
            if (!snapshot.isStale()) {
                anyFresh = true;
            }
        }

        if (speedByDirection.isEmpty()) {
            status.setSpeedKphByDirection(null);
            return;
        }

        status.setSpeedKphByDirection(speedByDirection);
        double worst = speedByDirection.values().stream().mapToDouble(Double::doubleValue).min().orElse(Double.NaN);
        if (!Double.isNaN(worst)) {
            status.setSpeedKph(worst);
            status.setSpeedStale(!anyFresh);
        }
    }

    private void applyRisk(TrafficStatus status, RoadRiskSnapshot risk) {
        if (risk == null) {
            status.setRiskIndex(null);
            status.setRiskGrade(null);
            status.setRiskScore(null);
            status.setRiskStale(true);
            return;
        }

        status.setRiskIndex(risk.getRiskIndex());
        status.setRiskGrade(risk.getRiskGrade());
        status.setRiskScore(risk.getRiskIndex());
        status.setRiskStale(risk.isStale());
    }

    private Integer calculateAverageWaitSec(Map<String, SignalDirection> signals) {
        if (signals == null || signals.isEmpty()) {
            return null;
        }

        int sum = 0;
        int count = 0;
        for (SignalDirection direction : signals.values()) {
            if (direction == null || direction.getStsg() == null) {
                continue;
            }
            sum += direction.getStsg().getRmndCs() / 10;
            count++;
        }
        return count == 0 ? null : Math.round((float) sum / count);
    }

    private String calculateCongestion(Double speedKph, Map<String, SignalDirection> signals) {
        if (speedKph != null) {
            if (speedKph < 15) {
                return "정체";
            }
            if (speedKph < 25) {
                return "서행";
            }
            return "원활";
        }

        Integer redWaitSec = calculateAverageRedStraightWaitSec(signals);
        if (redWaitSec == null) {
            return "알 수 없음";
        }
        if (redWaitSec > 60) {
            return "혼잡";
        }
        if (redWaitSec > 30) {
            return "서행";
        }
        return "원활";
    }

    private Integer calculateAverageRedStraightWaitSec(Map<String, SignalDirection> signals) {
        if (signals == null || signals.isEmpty()) {
            return null;
        }

        int sum = 0;
        int count = 0;
        for (SignalDirection direction : signals.values()) {
            if (direction == null || direction.getStsg() == null) {
                continue;
            }
            String status = direction.getStsg().getStatus();
            if (status != null && status.toLowerCase().contains("stop")) {
                sum += direction.getStsg().getRmndCs() / 10;
                count++;
            }
        }
        return count == 0 ? 0 : Math.round((float) sum / count);
    }

    private Optional<String> speedLinkId(CrossroadRoadLinkMapping mapping) {
        if (mapping == null) {
            return Optional.empty();
        }
        if (mapping.getSpeedLinkId() != null && !mapping.getSpeedLinkId().isBlank()) {
            return Optional.of(mapping.getSpeedLinkId());
        }
        if (mapping.getLinkId() != null && !mapping.getLinkId().isBlank()) {
            return Optional.of(mapping.getLinkId());
        }
        return Optional.empty();
    }

    private Optional<String> riskCacheKey(CrossroadRoadLinkMapping mapping) {
        if (mapping == null) {
            return Optional.empty();
        }
        if (mapping.getLineString() != null && !mapping.getLineString().isBlank()) {
            return Optional.of(mapping.getLineString());
        }
        if (mapping.getLinkId() != null && !mapping.getLinkId().isBlank()) {
            return Optional.of(mapping.getLinkId());
        }
        return Optional.empty();
    }
}
