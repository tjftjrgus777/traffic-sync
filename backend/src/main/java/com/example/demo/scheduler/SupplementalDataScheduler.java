package com.example.demo.scheduler;

import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.model.context.RoadRiskSnapshot;
import com.example.demo.model.context.RoadSpeedSnapshot;
import com.example.demo.model.context.WeatherSnapshot;
import com.example.demo.service.RoadRiskApiService;
import com.example.demo.service.CrossroadSupplementalMappingService;
import com.example.demo.service.SupplementalDataCacheService;
import com.example.demo.service.TopisApiService;
import com.example.demo.service.TrafficCacheService;
import com.example.demo.service.WeatherApiService;
import com.example.demo.websocket.TrafficWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.function.Consumer;

@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "traffic.supplemental.enabled", havingValue = "true", matchIfMissing = true)
public class SupplementalDataScheduler {

    private final WeatherApiService weatherApiService;
    private final TopisApiService topisApiService;
    private final RoadRiskApiService roadRiskApiService;
    private final CrossroadSupplementalMappingService crossroadSupplementalMappingService;
    private final TrafficCacheService trafficCacheService;
    private final SupplementalDataCacheService supplementalDataCacheService;
    private final TrafficWebSocketHandler webSocketHandler;

    @Value("${traffic.supplemental.parallelism:24}")
    private int supplementalParallelism;

    @Value("${topis.speed.refresh.max-concurrency:4}")
    private int topisSpeedMaxConcurrency;

    @Value("${topis.speed.refresh.max-wait-ms:12000}")
    private long topisSpeedMaxWaitMs;

    @Value("${topis.speed.refresh.max-links-per-run:80}")
    private int topisSpeedMaxLinksPerRun;

    @Value("${road-risk.refresh.max-per-run:250}")
    private int roadRiskMaxRequestsPerRun;

    @Value("${road-risk.refresh.max-concurrency:2}")
    private int roadRiskMaxConcurrency;

    @Value("${road-risk.refresh.min-age-ms:300000}")
    private long roadRiskRefreshMinAgeMs;

    @Value("${road-risk.refresh.stop-after-failures:3}")
    private int roadRiskStopAfterFailures;

    @Value("${road-risk.refresh.on-area-change:false}")
    private boolean roadRiskRefreshOnAreaChange;

    private final AtomicBoolean topisSpeedRefreshInProgress = new AtomicBoolean(false);
    private final AtomicBoolean roadRiskRefreshInProgress = new AtomicBoolean(false);
    private final AtomicInteger topisSpeedRotation = new AtomicInteger(0);
    // 구역 변경으로 인해 이전 run 진행 중 스킵됐을 때 완료 후 즉시 재실행 요청 플래그
    private final AtomicBoolean roadRiskPendingRefresh = new AtomicBoolean(false);

    @Scheduled(initialDelay = 3000, fixedRateString = "${weather.poll.interval-ms:600000}")
    public void refreshWeather() {
        if (!weatherApiService.isConfigured()) {
            log.debug("KMA service key not configured; weather refresh skipped");
            return;
        }

        try {
            WeatherSnapshot weather = weatherApiService.fetchJamsilWeather();
            supplementalDataCacheService.updateWeather(weather);
            log.info("Weather refreshed: baseDateTime={}", weather.getBaseDateTime());
        } catch (Exception e) {
            supplementalDataCacheService.markWeatherStale();
            log.warn("Weather refresh failed: {}", e.getMessage());
        }
    }

    @Scheduled(initialDelay = 10000, fixedRateString = "${road-link.mapping.interval-ms:86400000}")
    public void refreshRoadLinkMappings() {
        long startedAtMs = System.currentTimeMillis();
        List<CrossroadInfo> crossroads = trafficCacheService.getCrossroads();
        if (crossroads.isEmpty()) {
            log.debug("Crossroad cache is empty; road link mapping skipped");
            return;
        }

        try {
            Map<String, CrossroadRoadLinkMapping> mappings =
                    crossroadSupplementalMappingService.loadOrCreateMappings(crossroads);
            supplementalDataCacheService.updateMappings(mappings);

            // 각 교차로가 실제로 가진 V2X 신호 방향 → 진입 링크를 이 방향에 스냅해 키를 일치시킨다.
            Map<String, Set<String>> availableDirections = signalDirectionsByCrossroad();
            Map<String, Map<String, CrossroadRoadLinkMapping>> directionalMappings =
                    crossroadSupplementalMappingService.loadOrCreateDirectionalMappings(crossroads, availableDirections);
            supplementalDataCacheService.updateDirectionalMappings(directionalMappings);

            log.info("Crossroad supplemental mapping refreshed: crossroads={}, mapped={}, directional={}, elapsedMs={}",
                    crossroads.size(), mappings.size(), directionalMappings.size(),
                    System.currentTimeMillis() - startedAtMs);
        } catch (Exception e) {
            log.warn("Crossroad supplemental mapping refresh failed: {}", e.getMessage());
        }
    }

    @Scheduled(initialDelay = 15000, fixedRateString = "${topis.speed.poll.interval-ms:60000}")
    public void refreshRoadSpeeds() {
        long startedAtMs = System.currentTimeMillis();
        if (!topisApiService.isConfigured()) {
            log.debug("TOPIS service key not configured; speed refresh skipped");
            return;
        }
        if (!topisSpeedRefreshInProgress.compareAndSet(false, true)) {
            log.info("TOPIS speed refresh skipped: previous run still in progress");
            return;
        }

        try {
            Set<String> linkIds = supplementalDataCacheService.getMappedLinkIds();
            if (linkIds.isEmpty()) {
                log.info("TOPIS speed refresh skipped: no speed link mappings for current crossroads");
                return;
            }
            List<String> refreshLinkIds = rotatingSpeedRefreshTargets(linkIds);
            AtomicInteger successCount = new AtomicInteger(0);
            AtomicInteger failureCount = new AtomicInteger(0);
            ParallelRunResult runResult = forEachParallel(refreshLinkIds, topisSpeedMaxConcurrency, topisSpeedMaxWaitMs, linkId -> {
                try {
                    Optional<RoadSpeedSnapshot> speed = topisApiService.fetchSpeed(linkId);
                    if (speed.isPresent()) {
                        supplementalDataCacheService.updateSpeed(speed.get());
                        successCount.incrementAndGet();
                    }
                } catch (Exception e) {
                    if (e instanceof InterruptedException || Thread.currentThread().isInterrupted()) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                    supplementalDataCacheService.markSpeedsStale();
                    int failures = failureCount.incrementAndGet();
                    if (failures <= 3) {
                        log.warn("TOPIS speed refresh failed (linkId={}): {}", linkId, e.getMessage());
                    }
                }
            });
            if (failureCount.get() > 3) {
                log.warn("TOPIS speed refresh omitted {} additional failure logs", failureCount.get() - 3);
            }
            if (runResult.cancelledCount() > 0) {
                log.warn("TOPIS speed refresh cancelled {} pending requests after {}ms budget",
                        runResult.cancelledCount(), Math.max(0, topisSpeedMaxWaitMs));
            }
            log.info("TOPIS speed refreshed: success={}, failed={}, cancelled={}, total={}, elapsedMs={}",
                    successCount.get(), failureCount.get(), runResult.cancelledCount(), refreshLinkIds.size(),
                    System.currentTimeMillis() - startedAtMs);
        } finally {
            topisSpeedRefreshInProgress.set(false);
        }
    }

    private List<String> rotatingSpeedRefreshTargets(Set<String> linkIds) {
        List<String> sorted = linkIds.stream()
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .sorted()
                .toList();
        if (sorted.isEmpty()) {
            return List.of();
        }

        int maxPerRun = Math.max(1, topisSpeedMaxLinksPerRun);
        if (sorted.size() <= maxPerRun) {
            return sorted;
        }

        int start = Math.floorMod(topisSpeedRotation.getAndAdd(maxPerRun), sorted.size());
        List<String> targets = new ArrayList<>(maxPerRun);
        for (int i = 0; i < maxPerRun; i++) {
            targets.add(sorted.get((start + i) % sorted.size()));
        }
        return targets;
    }

    @Scheduled(initialDelay = 20000, fixedRateString = "${road-risk.poll.interval-ms:300000}")
    public void refreshRoadRisks() {
        long startedAtMs = System.currentTimeMillis();
        if (!roadRiskApiService.isConfigured()) {
            log.debug("Road risk service key not configured; risk refresh skipped");
            return;
        }
        if (!roadRiskRefreshInProgress.compareAndSet(false, true)) {
            // 구역 변경 등으로 인한 요청이면 pending 표시 → 현재 run 완료 후 즉시 재실행
            roadRiskPendingRefresh.set(true);
            log.info("Road risk refresh skipped: previous run still in progress (pending=true)");
            return;
        }

        roadRiskPendingRefresh.set(false);
        // 위험도도 현재 대시보드가 사용하는 대표 링크 기준으로만 수집한다.
        try {
            Collection<CrossroadRoadLinkMapping> mappings = supplementalDataCacheService.getMappings();
            List<CrossroadRoadLinkMapping> refreshTargets = roadRiskRefreshTargets(mappings, System.currentTimeMillis());
            RoadRiskRefreshStats stats = refreshRoadRiskTargets(refreshTargets);
            broadcastCurrentTrafficStatuses();

            log.info("Road risk refreshed: success={}, empty={}, failed={}, requested={}, uniqueLinks={}, elapsedMs={}",
                    stats.successCount(), stats.emptyCount(), stats.failureCount(), stats.requestedCount(),
                    uniqueRoadRiskMappings(mappings).size(), System.currentTimeMillis() - startedAtMs);
        } finally {
            roadRiskRefreshInProgress.set(false);
            // 이전 run 중 구역이 바뀐 경우 → 새 구역 위험도를 즉시 수집
            if (roadRiskPendingRefresh.compareAndSet(true, false)) {
                log.info("Road risk pending refresh detected — starting new run for current area");
                refreshRoadRisksAsync();
            }
        }
    }

    public void refreshRoadRisksAsync() {
        CompletableFuture.runAsync(this::refreshRoadRisks)
                .exceptionally(e -> {
                    log.warn("Async road risk refresh failed: {}", e.getMessage());
                    return null;
                });
    }

    public void refreshCurrentAreaSupplementalDataAsync() {
        CompletableFuture.runAsync(() -> {
                    refreshRoadLinkMappings();
                    refreshRoadSpeeds();
                    broadcastCurrentTrafficStatuses();
                    if (roadRiskRefreshOnAreaChange) {
                        refreshRoadRisks();
                    }
                })
                .exceptionally(e -> {
                    log.warn("Async current area supplemental refresh failed: {}", e.getMessage());
                    return null;
                });
    }

    private RoadRiskRefreshStats refreshRoadRiskTargets(List<CrossroadRoadLinkMapping> refreshTargets) {
        if (refreshTargets.isEmpty()) {
            return RoadRiskRefreshStats.empty();
        }

        int threadCount = Math.max(1, Math.min(roadRiskMaxConcurrency, refreshTargets.size()));
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CompletionService<RoadRiskFetchResult> completionService = new ExecutorCompletionService<>(executor);
        int submittedCount = 0;
        int completedCount = 0;
        int successCount = 0;
        int emptyCount = 0;
        int failureCount = 0;
        boolean stopSubmitting = false;

        try {
            while (completedCount < refreshTargets.size()) {
                while (!stopSubmitting
                        && submittedCount < refreshTargets.size()
                        && submittedCount - completedCount < threadCount) {
                    CrossroadRoadLinkMapping mapping = refreshTargets.get(submittedCount++);
                    completionService.submit(() -> fetchRoadRisk(mapping));
                }

                if (submittedCount == completedCount) {
                    break;
                }

                Future<RoadRiskFetchResult> future = completionService.take();
                RoadRiskFetchResult result = future.get();
                completedCount++;

                if (result.success()) {
                    successCount++;
                } else if (result.empty()) {
                    emptyCount++;
                } else {
                    failureCount++;
                    if (roadRiskStopAfterFailures > 0 && failureCount >= roadRiskStopAfterFailures) {
                        stopSubmitting = true;
                        log.warn("Road risk refresh stopped early after {} failures", failureCount);
                    }
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Road risk refresh interrupted: {}", e.getMessage());
        } catch (Exception e) {
            failureCount++;
            log.warn("Road risk refresh worker failed: {}", e.getMessage());
        } finally {
            executor.shutdownNow();
        }

        return new RoadRiskRefreshStats(successCount, emptyCount, failureCount, completedCount);
    }

    private RoadRiskFetchResult fetchRoadRisk(CrossroadRoadLinkMapping mapping) {
        try {
            Optional<RoadRiskSnapshot> risk = roadRiskApiService.fetchRisk(mapping);
            if (risk.isPresent()) {
                supplementalDataCacheService.updateRisk(riskCacheKey(mapping), risk.get());
                return RoadRiskFetchResult.successResult();
            }
            return RoadRiskFetchResult.emptyResult();
        } catch (Exception e) {
            supplementalDataCacheService.markRiskStale(riskCacheKey(mapping));
            log.warn("Road risk refresh failed (riskKey={}): {}", riskCacheKey(mapping), e.getMessage());
            return RoadRiskFetchResult.failureResult();
        }
    }

    // 현재 수집된 V2X 신호에서 교차로별 신호 방향 코드 집합을 추출한다.
    private Map<String, Set<String>> signalDirectionsByCrossroad() {
        Map<String, Set<String>> directions = new HashMap<>();
        trafficCacheService.getAllSignals().forEach((crsrdId, status) -> {
            if (status != null && status.getSignals() != null && !status.getSignals().isEmpty()) {
                directions.put(crsrdId, new HashSet<>(status.getSignals().keySet()));
            }
        });
        return directions;
    }

    private void broadcastCurrentTrafficStatuses() {
        Map<String, com.example.demo.model.TrafficStatus> currentSignals = trafficCacheService.getAllSignals();
        if (currentSignals.isEmpty()) {
            return;
        }
        supplementalDataCacheService.enrichTrafficStatuses(currentSignals);
        webSocketHandler.broadcast(currentSignals);
    }

    private List<CrossroadRoadLinkMapping> roadRiskRefreshTargets(
            Collection<CrossroadRoadLinkMapping> mappings,
            long nowMs
    ) {
        int maxRequests = Math.max(0, roadRiskMaxRequestsPerRun);
        if (maxRequests == 0) {
            return List.of();
        }

        return uniqueRoadRiskMappings(mappings).values().stream()
                .filter(mapping -> shouldRefreshRoadRisk(riskCacheKey(mapping), nowMs))
                .limit(maxRequests)
                .toList();
    }

    private Map<String, CrossroadRoadLinkMapping> uniqueRoadRiskMappings(Collection<CrossroadRoadLinkMapping> mappings) {
        Map<String, CrossroadRoadLinkMapping> uniqueByRiskKey = new LinkedHashMap<>();
        if (mappings == null) {
            return uniqueByRiskKey;
        }
        for (CrossroadRoadLinkMapping mapping : mappings) {
            String riskKey = riskCacheKey(mapping);
            if (riskKey.isBlank()) {
                continue;
            }
            uniqueByRiskKey.putIfAbsent(riskKey, mapping);
        }
        return uniqueByRiskKey;
    }

    private boolean shouldRefreshRoadRisk(String linkId, long nowMs) {
        Optional<RoadRiskSnapshot> cached = supplementalDataCacheService.getRisk(linkId);
        if (cached.isEmpty()) {
            return true;
        }

        long fetchedAtMs = cached.get().getLastFetchedAtMs();
        long minAgeMs = Math.max(0, roadRiskRefreshMinAgeMs);
        return fetchedAtMs <= 0 || nowMs - fetchedAtMs >= minAgeMs;
    }

    private String riskCacheKey(CrossroadRoadLinkMapping mapping) {
        if (mapping == null) {
            return "";
        }
        if (mapping.getLineString() != null && !mapping.getLineString().isBlank()) {
            return mapping.getLineString();
        }
        if (mapping.getLinkId() != null && !mapping.getLinkId().isBlank()) {
            return mapping.getLinkId();
        }
        return "";
    }

    private record RoadRiskRefreshStats(
            int successCount,
            int emptyCount,
            int failureCount,
            int requestedCount
    ) {
        static RoadRiskRefreshStats empty() {
            return new RoadRiskRefreshStats(0, 0, 0, 0);
        }
    }

    private record RoadRiskFetchResult(boolean success, boolean empty) {
        static RoadRiskFetchResult successResult() {
            return new RoadRiskFetchResult(true, false);
        }

        static RoadRiskFetchResult emptyResult() {
            return new RoadRiskFetchResult(false, true);
        }

        static RoadRiskFetchResult failureResult() {
            return new RoadRiskFetchResult(false, false);
        }
    }

    private <T> ParallelRunResult forEachParallel(Collection<T> items, Consumer<T> action) {
        return forEachParallel(items, supplementalParallelism, action);
    }

    private <T> ParallelRunResult forEachParallel(Collection<T> items, int parallelism, Consumer<T> action) {
        return forEachParallel(items, parallelism, 0, action);
    }

    private <T> ParallelRunResult forEachParallel(Collection<T> items, int parallelism, long timeoutMs, Consumer<T> action) {
        if (items.isEmpty()) {
            return ParallelRunResult.empty();
        }

        int threadCount = Math.max(1, Math.min(parallelism, items.size()));
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        try {
            List<Callable<Void>> tasks = new ArrayList<>();
            for (T item : items) {
                tasks.add(() -> {
                    action.accept(item);
                    return null;
                });
            }
            List<Future<Void>> futures = timeoutMs > 0
                    ? executor.invokeAll(tasks, timeoutMs, TimeUnit.MILLISECONDS)
                    : executor.invokeAll(tasks);
            int cancelledCount = (int) futures.stream().filter(Future::isCancelled).count();
            return new ParallelRunResult(futures.size() - cancelledCount, cancelledCount);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Supplemental parallel refresh interrupted: {}", e.getMessage());
            return new ParallelRunResult(0, items.size());
        } finally {
            executor.shutdownNow();
        }
    }

    private record ParallelRunResult(int completedCount, int cancelledCount) {
        static ParallelRunResult empty() {
            return new ParallelRunResult(0, 0);
        }
    }
}
