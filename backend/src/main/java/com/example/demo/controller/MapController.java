package com.example.demo.controller;

import com.example.demo.entity.CrossroadEntity;
import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.TrafficStatus;
import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.repository.CrossroadRepository;
import com.example.demo.scheduler.SupplementalDataScheduler;
import com.example.demo.service.CrossroadSupplementalMappingService;
import com.example.demo.service.SupplementalDataCacheService;
import com.example.demo.service.ChatService;
import com.example.demo.service.TopisMasterDataService;
import com.example.demo.service.TrafficCacheService;
import com.example.demo.service.V2xApiService;
import com.example.demo.websocket.TrafficWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequiredArgsConstructor
@CrossOrigin(origins = {"http://localhost:5173", "http://172.28.6.40:5173"})
public class MapController {


    //서비스 주입
    private final TrafficCacheService cacheService;
    //V2xApiService는 공공 API 호출하여 교차로 신호등 데이터 가져오는 서비스
    private final V2xApiService v2xApiService;
    //TrafficWebSocketHandler는 WebSocket 연결 관리 및 실시간 데이터 전송 담당
    private final TrafficWebSocketHandler webSocketHandler;
    //CrossroadRepository는 DB에서 교차로 정보 조회하는 리포지토리
    private final CrossroadRepository crossroadRepository;
    private final ChatService chatService;
    // WebSocket으로 내보내기 전 실제 속도/위험도/날씨 캐시를 TrafficStatus에 합친다.
    private final SupplementalDataCacheService supplementalDataCacheService;
    private final CrossroadSupplementalMappingService crossroadSupplementalMappingService;
    private final ObjectProvider<SupplementalDataScheduler> supplementalDataSchedulerProvider;
    private final TopisMasterDataService topisMasterDataService;

    @Value("${kakao.map.app-key}")
    private String kakaoAppKey;

    @Value("${jamsil.lat}")
    private double jamsilLat;

    @Value("${jamsil.lon}")
    private double jamsilLon;


    //지도 페이지 렌더링
    //캐시에 있는 전체 신호 데이터 반환하는 REST API 엔드포인트
    //웹소켓으로 이미 실시간으로 받고 있으니 --> 디버깅용임
    @GetMapping("/api/signals")
    @ResponseBody
    public Collection<TrafficStatus> getSignals() {
        Collection<TrafficStatus> signals = cacheService.getAllSignals().values();
        signals.forEach(supplementalDataCacheService::enrichTrafficStatus);
        return signals;
    }

    @PostMapping("/api/fetch-area")
    @ResponseBody
    public synchronized ResponseEntity<Map<String, Object>> fetchArea(
            @RequestParam(required = false) String guName,
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam(defaultValue = "1.0") double radius) {
        long startedAtMs = System.currentTimeMillis();
        if (!cacheService.beginAreaRefresh()) {
            return ResponseEntity.status(409).body(Map.of("message", "다른 구역 데이터를 수집 중입니다"));
        }
        try {
            // 선택된 구 좌표 캐시에 저장 → 스케줄러가 이 좌표로 폴링
            cacheService.setCenter(lat, lon, radius);


            // DB에서 해당 좌표 반경 교차로 조회
            List<CrossroadEntity> entities = crossroadRepository.findWithinRadius(lat, lon, radius);
            String normalizedGuName = normalizeGuName(guName);
            // 해당 구역에 교차로가 없으면 바로 응답
            if (entities.isEmpty()) {
                return ResponseEntity.ok(Map.of("count", 0, "message", "해당 구역에 교차로 없음"));
            }
            //[
            //  CrossroadEntity { crsrdId: "1007", crsrdNm: "잠실역사거리", lat: 37.51, lon: 127.08 }
            //  CrossroadEntity { crsrdId: "1008", crsrdNm: "석촌역사거리", lat: 37.50, lon: 127.10 }
            //  CrossroadEntity { crsrdId: "1009", crsrdNm: "롯데타워교차로", lat: 37.51, lon: 127.10 }
            //]

            //e = CrossroadEntity { crsrdId: "1007", ... } --> 하나씩 CrossroadInfo로 변환
            List<CrossroadInfo> crossroads = entities.stream().map(e -> {
                CrossroadInfo info = new CrossroadInfo();
                info.setCrsrdId(e.getCrsrdId());
                info.setCrsrdNm(e.getCrsrdNm());
                info.setLat(e.getLat());
                info.setLon(e.getLon());
                info.setGuName(normalizedGuName);
                return info;

            }).collect(Collectors.toList()); // .collect(Collectors.toList())  // Stream → List (파이프라인 종료)

            supplementalDataCacheService.clearRoadSupplementalData();
            Map<String, CrossroadRoadLinkMapping> mappings = crossroadSupplementalMappingService.loadOrCreateMappings(crossroads);
            supplementalDataCacheService.updateMappings(mappings);
            supplementalDataCacheService.updateDirectionalMappings(Map.of());

            //최종적으론 List<CrossroadInfo> crossroads = [
            //    CrossroadInfo { crsrdId: "1007", crsrdNm: "잠실역사거리",  lat: 37.51, lon: 127.08 },
            //    CrossroadInfo { crsrdId: "1008", crsrdNm: "석촌역사거리",  lat: 37.50, lon: 127.10 },
            //    CrossroadInfo { crsrdId: "1009", crsrdNm: "롯데타워교차로", lat: 37.51, lon: 127.10 }
            //] 이렇게 저장되서 v2xApiService.fetchSignalData(crossroads)로 전달됨

            // V2X API 불안정 대응: 최대 3회 재시도 (1초 간격)
            Map<String, TrafficStatus> signals = Map.of();
            for (int attempt = 1; attempt <= 3; attempt++) {
                signals = v2xApiService.fetchSignalData(crossroads);
                if (!signals.isEmpty()) break;
                log.warn("V2X API 빈 결과 — 재시도 {}/3", attempt);
                if (attempt < 3) {
                    try { Thread.sleep(1000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                }
            }

            if (signals.isEmpty()) {
                log.warn("V2X API 3회 재시도 후에도 빈 결과 (DB 교차로 {}개) — 캐시 유지", crossroads.size());
                return ResponseEntity.ok(Map.of(
                    "count", cacheService.getAllSignals().size(),
                    "message", "V2X API 일시 불안정 — 기존 캐시 유지 중"
                ));
            }

            // 선택 구역은 이전 구역과 섞이면 안 되므로 전체 캐시를 새 구역 데이터로 교체한다.
            cacheService.updateAllSignals(signals);

            // 보조 매핑은 먼저 확보하고, 속도/위험도 값은 백그라운드에서 갱신한다.
            refreshSupplementalDataForCurrentArea();
            supplementalDataCacheService.enrichTrafficStatuses(signals);
            cacheService.updateAllSignals(signals);
            webSocketHandler.broadcast(signals);
            log.info("구역 수집: ({},{}) 반경{}km → {}개, elapsedMs={}", lat, lon, radius, signals.size(), System.currentTimeMillis() - startedAtMs);
            return ResponseEntity.ok(Map.of("count", signals.size(), "message", "ok"));
        } catch (Exception e) {
            log.error("구역 수집 실패: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("message", e.getMessage()));
        } finally {
            cacheService.finishAreaRefresh();
        }
    }

    // 멀티에이전트용 인근 교차로 조회 — 캐시/V2X 건드리지 않는 순수 DB 조회
    @GetMapping("/api/crossroads/nearby")
    @ResponseBody
    public List<Map<String, Object>> getNearby(
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam(defaultValue = "2.5") double radius) {
        return crossroadRepository.findWithinRadius(lat, lon, radius).stream()
                .map(e -> Map.<String, Object>of(
                        "crsrdId", e.getCrsrdId(),
                        "crsrdNm", e.getCrsrdNm(),
                        "lat",     e.getLat(),
                        "lon",     e.getLon()
                ))
                .collect(Collectors.toList());
    }

    // 구 단위 AI 리포트 — 메인 대시보드 구 클릭 시 호출
    @PostMapping("/api/district/report")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> districtReport(@RequestBody Map<String, String> body) {
        String district = body.get("district");
        if (district == null || district.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "district 파라미터가 필요합니다."));
        }
        try {
            String report = chatService.districtReport(district);
            return ResponseEntity.ok(Map.of("report", report, "district", district));
        } catch (Exception e) {
            log.error("구 리포트 생성 실패: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    private void refreshSupplementalDataForCurrentArea() {
        supplementalDataSchedulerProvider.ifAvailable(scheduler -> {
            scheduler.refreshCurrentAreaSupplementalDataAsync();
        });
    }

    @PostMapping("/api/admin/sync-topis")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> syncTopis() {
        try {
            Map<String, Object> result = topisMasterDataService.syncMasterData();
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("TOPIS master sync failed: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("message", e.getMessage()));
        }
    }

    private String normalizeGuName(String guName) {
        if (guName == null || guName.isBlank()) {
            return null;
        }
        return guName.trim();
    }
}
