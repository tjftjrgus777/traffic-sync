package com.example.demo.scheduler;

import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.model.context.RoadRiskSnapshot;
import com.example.demo.model.context.RoadSpeedSnapshot;
import com.example.demo.repository.CrossroadRepository;
import com.example.demo.service.RoadRiskApiService;
import com.example.demo.service.CrossroadSupplementalMappingService;
import com.example.demo.service.SupplementalDataCacheService;
import com.example.demo.service.TopisApiService;
import com.example.demo.service.TrafficCacheService;
import com.example.demo.websocket.TrafficWebSocketHandler;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class SupplementalDataSchedulerTest {

    @Test
    void refreshRoadRisksDeduplicatesLinkIdsAndHonorsFiveMinuteCache() {
        SupplementalDataCacheService supplementalCache = new SupplementalDataCacheService();
        RecordingRoadRiskApiService riskApiService = new RecordingRoadRiskApiService();
        SupplementalDataScheduler scheduler = scheduler(supplementalCache, riskApiService);

        supplementalCache.updateMappings(Map.of(
                "C1", mapping("C1", "L1"),
                "C2", mapping("C2", "L1"),
                "C3", mapping("C3", "L2")
        ));

        scheduler.refreshRoadRisks();
        assertThat(riskApiService.calls()).containsExactlyInAnyOrder("L1", "L2");

        riskApiService.clearCalls();
        scheduler.refreshRoadRisks();
        assertThat(riskApiService.calls()).isEmpty();
    }

    @Test
    void refreshRoadSpeedsStopsAfterConfiguredWaitBudget() {
        SupplementalDataCacheService supplementalCache = new SupplementalDataCacheService();
        SlowTopisApiService topisApiService = new SlowTopisApiService();
        SupplementalDataScheduler scheduler = scheduler(
                supplementalCache,
                new RecordingRoadRiskApiService(),
                topisApiService
        );
        ReflectionTestUtils.setField(scheduler, "topisSpeedMaxConcurrency", 1);
        ReflectionTestUtils.setField(scheduler, "topisSpeedMaxWaitMs", 50L);

        supplementalCache.updateMappings(Map.of(
                "C1", mapping("C1", "L1"),
                "C2", mapping("C2", "L2"),
                "C3", mapping("C3", "L3")
        ));

        long startedAtMs = System.currentTimeMillis();
        scheduler.refreshRoadSpeeds();

        assertThat(System.currentTimeMillis() - startedAtMs).isLessThan(800L);
        assertThat(topisApiService.calls().size()).isLessThan(3);
    }

    @Test
    void refreshRoadSpeedsFallsBackToRiskLinkIdWhenSpeedLinkIdIsMissing() {
        SupplementalDataCacheService supplementalCache = new SupplementalDataCacheService();
        RecordingTopisApiService topisApiService = new RecordingTopisApiService();
        SupplementalDataScheduler scheduler = scheduler(
                supplementalCache,
                new RecordingRoadRiskApiService(),
                topisApiService
        );

        supplementalCache.updateMappings(Map.of(
                "C1", CrossroadRoadLinkMapping.builder()
                        .crsrdId("C1")
                        .linkId("L1")
                        .lineString("LineString(127.1 37.5,127.2 37.6)")
                        .build()
        ));

        scheduler.refreshRoadSpeeds();

        assertThat(topisApiService.calls()).containsExactly("L1");
        assertThat(supplementalCache.getSpeed("L1")).isPresent();
    }

    private SupplementalDataScheduler scheduler(
            SupplementalDataCacheService supplementalCache,
            RoadRiskApiService riskApiService
    ) {
        return scheduler(supplementalCache, riskApiService, null);
    }

    private SupplementalDataScheduler scheduler(
            SupplementalDataCacheService supplementalCache,
            RoadRiskApiService riskApiService,
            TopisApiService topisApiService
    ) {
        SupplementalDataScheduler scheduler = new SupplementalDataScheduler(
                null,
                topisApiService,
                riskApiService,
                mock(CrossroadSupplementalMappingService.class),
                new TrafficCacheService(),
                supplementalCache,
                mock(TrafficWebSocketHandler.class),
                mock(CrossroadRepository.class)
        );
        ReflectionTestUtils.setField(scheduler, "topisSpeedMaxConcurrency", 4);
        ReflectionTestUtils.setField(scheduler, "topisSpeedMaxWaitMs", 12_000L);
        ReflectionTestUtils.setField(scheduler, "roadRiskMaxRequestsPerRun", 250);
        ReflectionTestUtils.setField(scheduler, "roadRiskMaxConcurrency", 2);
        ReflectionTestUtils.setField(scheduler, "roadRiskRefreshMinAgeMs", 300_000L);
        ReflectionTestUtils.setField(scheduler, "roadRiskStopAfterFailures", 3);
        return scheduler;
    }

    private CrossroadRoadLinkMapping mapping(String crsrdId, String linkId) {
        String lon = switch (linkId) {
            case "L1" -> "127.1000";
            case "L2" -> "127.2000";
            case "L3" -> "127.3000";
            default -> "127.0000";
        };
        return CrossroadRoadLinkMapping.builder()
                .crsrdId(crsrdId)
                .linkId(linkId)
                .speedLinkId(linkId)
                .lineString("LineString(" + lon + " 37.5000," + lon + " 37.5005)")
                .build();
    }

    private static class RecordingRoadRiskApiService extends RoadRiskApiService {
        private final List<String> calls = Collections.synchronizedList(new ArrayList<>());

        RecordingRoadRiskApiService() {
            super(WebClient.builder().build());
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public Optional<RoadRiskSnapshot> fetchRisk(CrossroadRoadLinkMapping mapping) {
            calls.add(mapping.getLinkId());
            return Optional.of(RoadRiskSnapshot.builder()
                    .vehicleTypeCode("01")
                    .riskIndex(131.5)
                    .riskGrade("04")
                    .lineString(mapping.getLineString())
                    .lastFetchedAtMs(System.currentTimeMillis())
                    .build());
        }

        List<String> calls() {
            return List.copyOf(calls);
        }

        void clearCalls() {
            calls.clear();
        }
    }

    private static class SlowTopisApiService extends TopisApiService {
        private final List<String> calls = Collections.synchronizedList(new ArrayList<>());

        SlowTopisApiService() {
            super(WebClient.builder().build(), null, new DefaultResourceLoader());
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public Optional<RoadSpeedSnapshot> fetchSpeed(String linkId) throws Exception {
            calls.add(linkId);
            try {
                Thread.sleep(1_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw e;
            }
            return Optional.of(RoadSpeedSnapshot.builder()
                    .linkId(linkId)
                    .speedKph(20.0)
                    .lastFetchedAtMs(System.currentTimeMillis())
                    .build());
        }

        List<String> calls() {
            return List.copyOf(calls);
        }
    }

    private static class RecordingTopisApiService extends TopisApiService {
        private final List<String> calls = Collections.synchronizedList(new ArrayList<>());

        RecordingTopisApiService() {
            super(WebClient.builder().build(), null, new DefaultResourceLoader());
        }

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public Optional<RoadSpeedSnapshot> fetchSpeed(String linkId) {
            calls.add(linkId);
            return Optional.of(RoadSpeedSnapshot.builder()
                    .linkId(linkId)
                    .speedKph(24.0)
                    .lastFetchedAtMs(System.currentTimeMillis())
                    .build());
        }

        List<String> calls() {
            return List.copyOf(calls);
        }
    }
}
