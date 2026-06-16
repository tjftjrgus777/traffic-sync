package com.example.demo.scheduler;

import com.example.demo.entity.CrossroadEntity;
import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.TrafficStatus;
import com.example.demo.repository.CrossroadRepository;
import com.example.demo.service.SupplementalDataCacheService;
import com.example.demo.service.TrafficCacheService;
import com.example.demo.service.V2xApiService;
import com.example.demo.websocket.TrafficWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class TrafficScheduler {

    // V2X 공공API 호출 서비스
    private final V2xApiService v2xApiService;
    // 교차로 신호 상태 캐시 서비스
    private final TrafficCacheService cacheService;
    // WebSocket 핸들러 (실시간 데이터 브로드캐스트)
    private final TrafficWebSocketHandler webSocketHandler;
    // 교차로 정보 DB 접근 레포지토리
    private final CrossroadRepository crossroadRepository;
    // TOPIS 속도, 도로위험도, 날씨 등 보조 API 캐시를 TrafficStatus에 합치는 서비스
    private final SupplementalDataCacheService supplementalDataCacheService;

    @Value("${jamsil.lat}")
    private double jamsilLat;

    @Value("${jamsil.lon}")
    private double jamsilLon;

    @Value("${jamsil.radius-km}")
    private double radiusKm;

    @PostConstruct
    // 애플리케이션 시작 시 기본 구역(강남구) 좌표 설정 — 10초 후 첫 폴링이 이 좌표로 수집
    public void init() {
        cacheService.setCenter(jamsilLat, jamsilLon, radiusKm);
    }

    // 5초 후 첫 실행, 이후 ${traffic.poll.interval-ms}마다 실행 (예: 10000ms = 10초)
    @Scheduled(initialDelay = 10000, fixedRateString = "${traffic.poll.interval-ms}")
    public void pollTrafficData() {
        if (cacheService.isAreaRefreshInProgress()) {
            log.info("구역 수집 중이라 정기 폴링을 건너뜀");
            return;
        }
        log.info("===== 교통 데이터 폴링 시작 =====");
        try {
            // DB에서 현재 선택된 구 반경 교차로 조회 (기본: 잠실)
            List<CrossroadEntity> entities = crossroadRepository.findWithinRadius(
                cacheService.getCenterLat(), cacheService.getCenterLon(), cacheService.getCenterRadius()
            );
            if (entities.isEmpty()) {
                log.warn("DB에 반경 내 교차로 없음 - 초기 적재 대기 중");
                return;
            }


            // DB에서 조회된 교차로 엔티티를 API 호출에 필요한 CrossroadInfo 모델로 변환
            List<CrossroadInfo> crossroads = entities.stream().map(e -> {
                CrossroadInfo info = new CrossroadInfo();
                info.setCrsrdId(e.getCrsrdId());
                info.setCrsrdNm(e.getCrsrdNm());
                info.setLat(e.getLat());
                info.setLon(e.getLon());
                return info;
            }).collect(Collectors.toList());

            log.info("DB 교차로 조회: {}개", crossroads.size());

            // V2X API 호출하여 교차로별 최신 신호 상태 가져오기
            Map<String, TrafficStatus> freshData = v2xApiService.fetchSignalData(crossroads);

            // V2X 신호가 비어도(예: 서울 실시간 피드 NODATA) 속도·위험도·날씨 보조데이터는 보여주도록
            // DB 교차로 목록으로 빈 신호 스켈레톤을 만든다. 신호가 다시 들어오면 다음 폴링이 전체 수집으로 복귀한다.
            if (freshData.isEmpty()) {
                log.warn("폴링: V2X 신호 빈 결과 (DB 교차로 {}개) — 신호 없이 보조데이터로 폴백", crossroads.size());
                freshData = buildSkeletons(crossroads);
            } else if (freshData.size() < crossroads.size()) {
                // 신호 API가 일부 교차로만 반환한 경우 — 누락된 교차로를 스켈레톤으로 채워 항상 DB 전체를 브로드캐스트한다.
                int signalCount = freshData.size();
                Map<String, TrafficStatus> skeletons = buildSkeletons(crossroads);
                skeletons.forEach(freshData::putIfAbsent);
                log.warn("폴링: 부분 신호 결과 {}/{} — 누락 {}개 스켈레톤 보완",
                        signalCount, crossroads.size(), crossroads.size() - signalCount);
            }

            // V2X 빈/부분 응답이거나 구를 바꿔도, 한 번이라도 받은 신호는 영구 보관소에서 채워
            // 화면에서 신호등이 사라지는 것을 막는다. (enrich 전에 채워야 avgWait/혼잡도도 정확)
            cacheService.fillStaleSignals(freshData);

            // 프론트와 챗봇이 같은 값을 쓰도록 실제 보조 API 캐시와 계산 지표를 합친다.
            supplementalDataCacheService.enrichTrafficStatuses(freshData);
            // API 호출 결과를 캐시에 업데이트 (교차로ID → 신호 상태 맵)
            cacheService.updateAllSignals(freshData);
            // WebSocket 핸들러를 통해 프론트엔드에 실시간 데이터 브로드캐스트
            webSocketHandler.broadcast(freshData);

            log.info("===== 폴링 완료: {}개 브로드캐스트 =====", freshData.size());

        } catch (Exception e) {
            log.error("폴링 중 오류 발생: {}", e.getMessage(), e);
        }
    }

    // V2X 신호가 없을 때 DB 교차로 목록으로 빈 신호 TrafficStatus를 만든다.
    // 신호는 비어 있지만 crsrdId·좌표가 있어 enrich 단계에서 속도·위험도·날씨를 붙일 수 있다.
    private Map<String, TrafficStatus> buildSkeletons(List<CrossroadInfo> crossroads) {
        Map<String, TrafficStatus> skeletons = new HashMap<>();
        for (CrossroadInfo c : crossroads) {
            TrafficStatus status = new TrafficStatus();
            status.setCrsrdId(c.getCrsrdId());
            status.setCrsrdNm(c.getCrsrdNm());
            status.setLat(c.getLat());
            status.setLon(c.getLon());
            status.setGuName(c.getGuName());
            status.setSignals(new HashMap<>());
            status.setServerTimeMs(System.currentTimeMillis());
            skeletons.put(c.getCrsrdId(), status);
        }
        return skeletons;
    }
}
