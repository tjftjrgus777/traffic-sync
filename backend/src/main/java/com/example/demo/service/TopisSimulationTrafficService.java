package com.example.demo.service;

import com.example.demo.entity.SignalCrossroadEntity;
import com.example.demo.entity.TopisAxisLinkEntity;
import com.example.demo.entity.TopisLinkVertexEntity;
import com.example.demo.entity.TopisRoadAxisEntity;
import com.example.demo.model.context.GeoPoint;
import com.example.demo.model.context.RoadSpeedSnapshot;
import com.example.demo.model.context.TopisLinkGeometry;
import com.example.demo.repository.SignalCrossroadRepository;
import com.example.demo.repository.TopisAxisLinkRepository;
import com.example.demo.repository.TopisLinkVertexRepository;
import com.example.demo.repository.TopisRoadAxisRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class TopisSimulationTrafficService {

    private final SignalCrossroadRepository signalCrossroadRepository;
    private final TopisRoadAxisRepository roadAxisRepository;
    private final TopisAxisLinkRepository axisLinkRepository;
    private final TopisLinkVertexRepository linkVertexRepository;
    private final TopisApiService topisApiService;
    private final SupplementalDataCacheService supplementalDataCacheService;
    private final SignalService signalService;

    @Value("${topis.route-traffic.max-match-distance-meters:90}")
    private double maxMatchDistanceMeters;

    @Value("${topis.route-traffic.max-bearing-diff-degrees:45}")
    private double maxBearingDiffDegrees;

    @Value("${topis.route-traffic.max-links-per-direction:10}")
    private int maxLinksPerDirection;

    @Value("${topis.route-traffic.master-cache-ttl-ms:60000}")
    private long masterCacheTtlMs;

    @Value("${topis.simulation-network.endpoint-match-distance-meters:180}")
    private double networkEndpointMatchDistanceMeters;

    @Value("${topis.simulation-network.cache-ttl-ms:3600000}")
    private long managedTrafficCacheTtlMs;

    @Value("${topis.simulation-network.prewarm-enabled:true}")
    private boolean managedTrafficPrewarmEnabled;

    @Value("${topis.speed.cache-ttl-ms:90000}")
    private long topisSpeedCacheTtlMs;

    @Value("${topis.simulation-traffic.area.default-radius-km:2.5}")
    private double managedTrafficDefaultRadiusKm;

    @Value("${topis.simulation-traffic.speed-prefetch.enabled:true}")
    private boolean managedTrafficSpeedPrefetchEnabled;

    @Value("${topis.simulation-traffic.speed-prefetch.max-concurrency:12}")
    private int managedTrafficSpeedPrefetchMaxConcurrency;

    @Value("${topis.simulation-traffic.speed-prefetch.max-wait-ms:3500}")
    private long managedTrafficSpeedPrefetchMaxWaitMs;

    @Value("${topis.simulation-traffic.speed-prefetch.max-links:160}")
    private int managedTrafficSpeedPrefetchMaxLinks;

    private volatile MasterCache masterCache;
    private volatile ManagedTrafficCache managedTrafficCache;

    @EventListener(ApplicationReadyEvent.class)
    public void prewarmManagedTrafficCacheOnStartup() {
        if (!managedTrafficPrewarmEnabled) {
            return;
        }

        CompletableFuture.runAsync(() -> {
            long startedAtMs = System.currentTimeMillis();
            try {
                ManagedTrafficCache network = loadManagedTrafficCache();
                supplementalDataCacheService.updateManagedTrafficLinkIds(network.linkIds());
                log.info("TOPIS managed traffic geometry cache warmed: links={}, crossroads={}, elapsedMs={}",
                        network.links().size(), network.crossroadCount(), System.currentTimeMillis() - startedAtMs);
            } catch (Exception e) {
                log.warn("TOPIS managed traffic geometry cache warmup failed: {}", e.getMessage());
            }
        });
    }

    public Map<String, Object> buildManagedTrafficLinks() {
        return buildManagedTrafficLinks(null, null, null);
    }

    public Map<String, Object> buildManagedTrafficLinks(Double centerLat, Double centerLon, Double radiusKm) {
        ManagedTrafficCache network = loadManagedTrafficCache();
        List<Map<String, Object>> scopedCachedLinks = managedTrafficLinksInArea(network, centerLat, centerLon, radiusKm);
        Set<String> scopedLinkIds = scopedCachedLinks.stream()
                .map(link -> stringValue(link, "linkId"))
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .collect(Collectors.toCollection(java.util.LinkedHashSet::new));

        supplementalDataCacheService.updateManagedTrafficLinkIds(scopedLinkIds);
        prefetchManagedTrafficSpeeds(scopedLinkIds);

        List<Map<String, Object>> links = new ArrayList<>(scopedCachedLinks.size());
        for (Map<String, Object> cachedLink : scopedCachedLinks) {
            Map<String, Object> link = new LinkedHashMap<>(cachedLink);
            applyCachedSpeed(link, String.valueOf(link.get("linkId")));
            links.add(link);
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", "topis-managed-crossroad-network");
        response.put("crossroadCount", network.crossroadCount());
        response.put("areaScoped", isAreaRequest(centerLat, centerLon));
        response.put("areaCenterLat", centerLat);
        response.put("areaCenterLon", centerLon);
        response.put("areaRadiusKm", effectiveAreaRadiusKm(radiusKm));
        response.put("linkCount", links.size());
        response.put("links", links);
        response.put("generatedAtMs", System.currentTimeMillis());
        response.put("geometryCachedAtMs", network.loadedAtMs());
        response.put("geometryCacheAgeMs", Math.max(0, System.currentTimeMillis() - network.loadedAtMs()));
        response.put("reason", network.reason());
        return response;
    }

    private ManagedTrafficCache loadManagedTrafficCache() {
        ManagedTrafficCache current = managedTrafficCache;
        long now = System.currentTimeMillis();
        if (current != null && now - current.loadedAtMs() < managedTrafficCacheTtlMs) {
            return current;
        }

        synchronized (this) {
            current = managedTrafficCache;
            now = System.currentTimeMillis();
            if (current != null && now - current.loadedAtMs() < managedTrafficCacheTtlMs) {
                return current;
            }

            current = buildManagedTrafficCache(now);
            managedTrafficCache = current;
            return current;
        }
    }

    private ManagedTrafficCache buildManagedTrafficCache(long loadedAtMs) {
        List<ManagedCrossroad> crossroads = signalCrossroadRepository.findAll().stream()
                .map(this::managedCrossroad)
                .flatMap(Optional::stream)
                .toList();

        MasterCache cache = loadMasterCache();
        if (crossroads.size() < 2) {
            return new ManagedTrafficCache(
                    crossroads.size(),
                    List.of(),
                    Set.of(),
                    loadedAtMs,
                    "At least two signal crossroads are required"
            );
        }
        if (cache.axisLinksByLinkId().isEmpty() || cache.geometriesByLinkId().isEmpty()) {
            return new ManagedTrafficCache(
                    crossroads.size(),
                    List.of(),
                    Set.of(),
                    loadedAtMs,
                    "TOPIS master link data is empty"
            );
        }

        List<Map<String, Object>> links = new ArrayList<>();
        Set<String> seenLinkIds = new java.util.LinkedHashSet<>();

        for (TopisAxisLinkEntity link : cache.axisLinksByLinkId().values()) {
            TopisLinkGeometry geometry = cache.geometriesByLinkId().get(link.getLinkId());
            if (geometry == null || geometry.getVertices() == null || geometry.getVertices().size() < 2) {
                continue;
            }

            List<GeoPoint> vertices = geometry.getVertices();
            ManagedEndpoint from = nearestEndpointCrossroad(vertices.get(0), crossroads);
            ManagedEndpoint to = nearestEndpointCrossroad(vertices.get(vertices.size() - 1), crossroads);
            if (from == null || to == null || from.crossroad().intNo().equals(to.crossroad().intNo())) {
                continue;
            }

            if (!seenLinkIds.add(link.getLinkId())) {
                continue;
            }
            links.add(managedTrafficLinkPayload(link, geometry, from, to, cache));
        }

        return new ManagedTrafficCache(
                crossroads.size(),
                List.copyOf(links),
                Set.copyOf(seenLinkIds),
                loadedAtMs,
                null
        );
    }

    public Map<String, Object> buildManagedTrafficLinkStatuses(Collection<String> linkIds) {
        ManagedTrafficCache network = loadManagedTrafficCache();
        supplementalDataCacheService.updateManagedTrafficLinkIds(linkIds);
        Map<String, Map<String, Object>> staticLinksById = network.links().stream()
                .filter(link -> link.get("linkId") != null)
                .collect(Collectors.toMap(
                        link -> String.valueOf(link.get("linkId")),
                        Function.identity(),
                        (left, right) -> left,
                        LinkedHashMap::new
                ));

        List<Map<String, Object>> statuses = linkIds == null
                ? List.of()
                : linkIds.stream()
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .distinct()
                .map(linkId -> {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("linkId", linkId);
                    Map<String, Object> staticLink = staticLinksById.get(linkId);
                    if (staticLink != null) {
                        payload.put("roadDivCd", staticLink.get("roadDivCd"));
                        payload.put("roadType", staticLink.get("roadType"));
                        payload.put("axisCd", staticLink.get("axisCd"));
                        payload.put("axisName", staticLink.get("axisName"));
                        payload.put("axisDir", staticLink.get("axisDir"));
                    }
                    applyCachedSpeed(payload, linkId);
                    return payload;
                })
                .toList();

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("source", "topis-managed-crossroad-network-status");
        response.put("statuses", statuses);
        response.put("generatedAtMs", System.currentTimeMillis());
        return response;
    }

    public Map<String, Object> buildRouteTraffic(Map<String, Object> request) {
        List<RouteNode> nodes = routeNodes(request == null ? null : request.get("routeNodes"));
        String requestedTravelDir = stringValue(request, "travelDir");  // 상행/하행
        log.info("route-traffic request travelDir={}", requestedTravelDir);

        Map<String, Object> response = new LinkedHashMap<>();

        if (nodes.size() < 2) {
            response.put("segments", List.of());
            response.put("reason", "routeNodes must contain at least two nodes");
            return response;
        }

        MasterCache cache = loadMasterCache();
        if (cache.axisLinksByLinkId().isEmpty()) {
            response.put("segments", List.of());
            response.put("reason", "TOPIS_AXIS_LINK is empty. Sync LinkWithLoad master data first.");
            return response;
        }

        Map<String, Optional<RoadSpeedSnapshot>> speedCache = new HashMap<>();
        List<Map<String, Object>> segments = new ArrayList<>();

        for (int i = 0; i < nodes.size() - 1; i++) {
            RouteNode from = nodes.get(i);
            RouteNode to = nodes.get(i + 1);
            SegmentResult segmentResult = buildSegmentTraffic(from, to, cache, speedCache, requestedTravelDir);  // requestedTravelDir: 상행/하행
            segments.add(segmentResult.payload());
        }

        response.put("segments", segments);
        response.put("vehicleMovements", buildVehicleMovements(nodes, segments));
        return response;
    }

    private SegmentResult buildSegmentTraffic(
            RouteNode from,
            RouteNode to,
            MasterCache cache,
            Map<String, Optional<RoadSpeedSnapshot>> speedCache,
            String requestedTravelDir
    ) {
        Map<String, Object> segment = new LinkedHashMap<>();
        segment.put("fromIntNo", from.intNo());
        segment.put("toIntNo", to.intNo());

        List<CandidateLink> candidates = candidateLinks(from.point(), to.point(), cache);
        if (candidates.isEmpty()) {
            segment.put("axisCd", null);
            segment.put("axisName", null);

            String travelDir = normalizeTravelDir(requestedTravelDir);
            log.info("route-traffic normalized travelDir={}", travelDir);
            if (travelDir != null) {
                segment.put("travelDir", travelDir);
            }

            segment.put("up", null);
            segment.put("down", null);
            segment.put("reason", "No TOPIS LinkWithLoad links near this route segment");
            return new SegmentResult(segment, List.of(), null);
        }


        String axisCd = bestAxisCd(candidates);
        TopisRoadAxisEntity axis = cache.axesByAxisCd().get(axisCd);
        List<CandidateLink> axisCandidates = candidates.stream()
                .filter(candidate -> axisCd.equals(candidate.link().getAxisCd()))
                .toList();

        segment.put("axisCd", axisCd);
        segment.put("axisName", axis == null ? null : axis.getAxisName());

        String travelDir = normalizeTravelDir(requestedTravelDir);
        if (travelDir != null) {
            segment.put("travelDir", travelDir);
        }

        Map<String, List<CandidateLink>> byDirection = axisCandidates.stream()
                .collect(Collectors.groupingBy(
                        candidate -> safeDirection(candidate.link().getAxisDir()),
                        LinkedHashMap::new,
                        Collectors.toList()
                ));


        List<Double> segmentSpeeds = new ArrayList<>();
        Bottleneck bottleneck = null;
        segment.put("up", null);
        segment.put("down", null);

        for (Map.Entry<String, List<CandidateLink>> entry : byDirection.entrySet()) {
            CandidateLink link = entry.getValue().stream()
                    .sorted(Comparator.comparingDouble(this::candidateScore)
                            .thenComparing((CandidateLink candidate) -> candidate.link().getLinkSeq(), Comparator.nullsLast(Integer::compareTo)))
                    .findFirst()
                    .orElse(null);

            if (link == null) {
                continue;
            }

            LinkResult linkResult = buildLink(entry.getKey(), link, axis, speedCache);
            String key = directionKey(entry.getKey());
            if (key != null) {
                segment.put(key, linkResult.payload());
            }
            segmentSpeeds.addAll(linkResult.speedValues());
            if (linkResult.bottleneck() != null
                    && (bottleneck == null || linkResult.bottleneck().speedKph() < bottleneck.speedKph())) {
                bottleneck = linkResult.bottleneck();
            }
        }

        String selectedKey = directionKey(travelDir);
        log.info("route-traffic selectedKey={}", selectedKey);
        if (selectedKey != null) {
            segment.put("selectedTraffic", segment.get(selectedKey));
        }

        return new SegmentResult(segment, segmentSpeeds, bottleneck);
    }

    private static String normalizeTravelDir(String value) {
        if (value == null || value.isBlank()) return null;

        String v = value.trim();

        if ("up".equalsIgnoreCase(v) || "\uC0C1\uD589".equals(v)) {
            return "\uC0C1\uD589"; // 상행
        }

        if ("down".equalsIgnoreCase(v) || "\uD558\uD589".equals(v)) {
            return "\uD558\uD589"; // 하행
        }

        return null;
    }

    private LinkResult buildLink(
            String axisDir,
            CandidateLink candidate,
            TopisRoadAxisEntity axis,
            Map<String, Optional<RoadSpeedSnapshot>> speedCache
    ) {
        List<Double> speeds = new ArrayList<>();
        Bottleneck bottleneck = null;

        String linkId = candidate.link().getLinkId();
        Optional<RoadSpeedSnapshot> speed = speedForLink(linkId, speedCache);
        Map<String, Object> linkPayload = new LinkedHashMap<>();
        linkPayload.put("linkId", linkId);
        linkPayload.put("roadDivCd", axis == null ? null : axis.getRoadDivCd());
        linkPayload.put("roadType", trafficRoadType(axis));
        linkPayload.put("vertices", verticesPayload(candidate.geometry().getVertices()));

        if (speed.isPresent()) {
            RoadSpeedSnapshot snapshot = speed.get();
            boolean speedStale = isSpeedStale(snapshot);
            linkPayload.put("speedKph", snapshot.getSpeedKph());
            linkPayload.put("congestion", speedStale
                    ? generalRoadCongestion(null, axis == null ? null : axis.getRoadDivCd())
                    : generalRoadCongestion(snapshot.getSpeedKph(), axis == null ? null : axis.getRoadDivCd()));
            linkPayload.put("speedStale", speedStale);
            linkPayload.put("lastFetchedAtMs", snapshot.getLastFetchedAtMs());
            if (!speedStale && snapshot.getSpeedKph() != null) {
                speeds.add(snapshot.getSpeedKph());
                bottleneck = new Bottleneck(linkId, axisDir, snapshot.getSpeedKph());
            }
        } else {
            linkPayload.put("speedKph", null);
            linkPayload.put("congestion", generalRoadCongestion(null, axis == null ? null : axis.getRoadDivCd()));
            linkPayload.put("speedStale", true);
            linkPayload.put("lastFetchedAtMs", null);
        }

        return new LinkResult(linkPayload, speeds, bottleneck);
    }

    private Optional<RoadSpeedSnapshot> speedForLink(
            String linkId,
            Map<String, Optional<RoadSpeedSnapshot>> speedCache
    ) {
        if (linkId == null || linkId.isBlank()) {
            return Optional.empty();
        }

        Optional<RoadSpeedSnapshot> cached = speedCache.get(linkId);
        if (cached != null) {
            return cached;
        }

        Optional<RoadSpeedSnapshot> speed = supplementalDataCacheService.getSpeed(linkId);
        if (speed.isPresent() && !speed.get().isStale()) {
            speedCache.put(linkId, speed);
            return speed;
        }

        if (topisApiService.isConfigured()) {
            try {
                speed = topisApiService.fetchSpeed(linkId);
                speed.ifPresent(supplementalDataCacheService::updateSpeed);
            } catch (Exception e) {
                log.debug("TrafficInfo fetch failed for linkId={}: {}", linkId, e.getMessage());
                if (speed.isEmpty()) {
                    speed = supplementalDataCacheService.getSpeed(linkId);
                }
            }
        }

        speedCache.put(linkId, speed);
        return speed;
    }

    private Map<String, Object> managedTrafficLinkPayload(
            TopisAxisLinkEntity link,
            TopisLinkGeometry geometry,
            ManagedEndpoint from,
            ManagedEndpoint to,
            MasterCache cache
    ) {
        TopisRoadAxisEntity axis = cache.axesByAxisCd().get(link.getAxisCd());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("linkId", link.getLinkId());
        payload.put("axisCd", link.getAxisCd());
        payload.put("axisName", axis == null ? null : axis.getAxisName());
        payload.put("roadDivCd", axis == null ? null : axis.getRoadDivCd());
        payload.put("roadType", trafficRoadType(axis));
        payload.put("axisDir", link.getAxisDir());
        payload.put("linkSeq", link.getLinkSeq());
        payload.put("fromIntNo", from.crossroad().intNo());
        payload.put("fromIntNm", from.crossroad().intNm());
        payload.put("fromLat", from.crossroad().point().getLat());
        payload.put("fromLon", from.crossroad().point().getLon());
        payload.put("toIntNo", to.crossroad().intNo());
        payload.put("toIntNm", to.crossroad().intNm());
        payload.put("toLat", to.crossroad().point().getLat());
        payload.put("toLon", to.crossroad().point().getLon());
        payload.put("fromMatchDistanceMeters", round1(from.distanceMeters()));
        payload.put("toMatchDistanceMeters", round1(to.distanceMeters()));
        payload.put("matchType", "endpoint");
        payload.put("lengthMeters", round1(polylineLengthMeters(geometry.getVertices())));
        payload.put("vertices", verticesPayload(geometry.getVertices()));
        return payload;
    }

    private List<Map<String, Object>> managedTrafficLinksInArea(
            ManagedTrafficCache network,
            Double centerLat,
            Double centerLon,
            Double radiusKm
    ) {
        if (!isAreaRequest(centerLat, centerLon)) {
            return network.links();
        }

        GeoPoint center = new GeoPoint(centerLat, centerLon);
        double radiusMeters = effectiveAreaRadiusKm(radiusKm) * 1000.0;
        return network.links().stream()
                .filter(link -> endpointWithinArea(link, center, radiusMeters, "from")
                        || endpointWithinArea(link, center, radiusMeters, "to"))
                .toList();
    }

    private boolean endpointWithinArea(Map<String, Object> link, GeoPoint center, double radiusMeters, String prefix) {
        Double lat = doubleValue(link, prefix + "Lat");
        Double lon = doubleValue(link, prefix + "Lon");
        if (lat == null || lon == null) {
            return false;
        }
        return GeoDistanceUtils.haversineMeters(center, new GeoPoint(lat, lon)) <= radiusMeters;
    }

    private boolean isAreaRequest(Double centerLat, Double centerLon) {
        return centerLat != null && centerLon != null
                && Double.isFinite(centerLat) && Double.isFinite(centerLon);
    }

    private double effectiveAreaRadiusKm(Double radiusKm) {
        if (radiusKm == null || !Double.isFinite(radiusKm) || radiusKm <= 0) {
            return Math.max(0.1, managedTrafficDefaultRadiusKm);
        }
        return Math.min(Math.max(radiusKm, 0.1), 10.0);
    }

    private void prefetchManagedTrafficSpeeds(Collection<String> linkIds) {
        if (!managedTrafficSpeedPrefetchEnabled || !topisApiService.isConfigured() || linkIds == null || linkIds.isEmpty()) {
            return;
        }

        List<String> targets = linkIds.stream()
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .distinct()
                .filter(this::shouldPrefetchManagedTrafficSpeed)
                .limit(Math.max(1, managedTrafficSpeedPrefetchMaxLinks))
                .toList();

        if (targets.isEmpty()) {
            return;
        }

        int threadCount = Math.max(1, Math.min(managedTrafficSpeedPrefetchMaxConcurrency, targets.size()));
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        try {
            List<Callable<Void>> tasks = targets.stream()
                    .map(linkId -> (Callable<Void>) () -> {
                        fetchAndCacheManagedTrafficSpeed(linkId);
                        return null;
                    })
                    .toList();

            List<Future<Void>> futures = managedTrafficSpeedPrefetchMaxWaitMs > 0
                    ? executor.invokeAll(tasks, managedTrafficSpeedPrefetchMaxWaitMs, TimeUnit.MILLISECONDS)
                    : executor.invokeAll(tasks);
            long cancelled = futures.stream().filter(Future::isCancelled).count();
            if (cancelled > 0) {
                log.debug("TOPIS simulation traffic speed prefetch timed out: requested={}, cancelled={}",
                        targets.size(), cancelled);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.debug("TOPIS simulation traffic speed prefetch interrupted: {}", e.getMessage());
        } finally {
            executor.shutdownNow();
        }
    }

    private boolean shouldPrefetchManagedTrafficSpeed(String linkId) {
        Optional<RoadSpeedSnapshot> cached = supplementalDataCacheService.getSpeed(linkId);
        return cached.isEmpty() || isSpeedStale(cached.get());
    }

    private void fetchAndCacheManagedTrafficSpeed(String linkId) {
        if (Thread.currentThread().isInterrupted()) {
            return;
        }
        try {
            Optional<RoadSpeedSnapshot> speed = topisApiService.fetchSpeed(linkId);
            speed.ifPresent(supplementalDataCacheService::updateSpeed);
        } catch (Exception e) {
            log.debug("TOPIS simulation traffic speed prefetch failed (linkId={}): {}", linkId, e.getMessage());
        }
    }

    private void applyCachedSpeed(Map<String, Object> payload, String linkId) {
        applySpeed(payload, supplementalDataCacheService.getSpeed(linkId));
    }

    private void applySpeed(Map<String, Object> payload, Optional<RoadSpeedSnapshot> speed) {
        if (speed.isPresent()) {
            RoadSpeedSnapshot snapshot = speed.get();
            boolean speedStale = isSpeedStale(snapshot);
            payload.put("speedKph", snapshot.getSpeedKph());
            payload.put("travelTimeSec", snapshot.getTravelTimeSec());
            payload.put("congestion", speedStale
                    ? generalRoadCongestion(null, payload.get("roadDivCd"))
                    : generalRoadCongestion(snapshot.getSpeedKph(), payload.get("roadDivCd")));
            payload.put("speedStale", speedStale);
            payload.put("lastFetchedAtMs", snapshot.getLastFetchedAtMs());
            return;
        }

        payload.put("speedKph", null);
        payload.put("travelTimeSec", null);
        payload.put("congestion", generalRoadCongestion(null, payload.get("roadDivCd")));
        payload.put("speedStale", true);
        payload.put("lastFetchedAtMs", null);
    }

    private boolean isSpeedStale(RoadSpeedSnapshot snapshot) {
        if (snapshot == null || snapshot.isStale()) {
            return true;
        }
        long fetchedAtMs = snapshot.getLastFetchedAtMs();
        if (fetchedAtMs <= 0) {
            return true;
        }
        long maxAgeMs = Math.max(1, topisSpeedCacheTtlMs);
        return System.currentTimeMillis() - fetchedAtMs > maxAgeMs;
    }

    private Optional<ManagedCrossroad> managedCrossroad(SignalCrossroadEntity crossroad) {
        if (crossroad == null) {
            return Optional.empty();
        }
        Double lon = parseCoord(crossroad.getXCoord());
        Double lat = parseCoord(crossroad.getYCoord());
        if (lon == null || lat == null) {
            return Optional.empty();
        }
        return Optional.of(new ManagedCrossroad(
                crossroad.getIntNo(),
                crossroad.getIntNm(),
                new GeoPoint(lat, lon)
        ));
    }

    private ManagedEndpoint nearestEndpointCrossroad(GeoPoint point, List<ManagedCrossroad> crossroads) {
        ManagedEndpoint best = null;
        for (ManagedCrossroad crossroad : crossroads) {
            double distance = GeoDistanceUtils.haversineMeters(point, crossroad.point());
            if (distance > networkEndpointMatchDistanceMeters) {
                continue;
            }
            if (best == null || distance < best.distanceMeters()) {
                best = new ManagedEndpoint(crossroad, distance);
            }
        }
        return best;
    }

    private List<CandidateLink> candidateLinks(GeoPoint from, GeoPoint to, MasterCache cache) {
        List<CandidateLink> candidates = new ArrayList<>();
        double routeBearing = bearingDegrees(from, to);
        GeoPoint routeMiddle = interpolate(from, to, 0.5);

        for (TopisAxisLinkEntity link : cache.axisLinksByLinkId().values()) {
            TopisLinkGeometry geometry = cache.geometriesByLinkId().get(link.getLinkId());
            if (geometry == null || geometry.getVertices() == null || geometry.getVertices().size() < 2) {
                continue;
            }
            double distance = GeoDistanceUtils.distanceToPolylineMeters(routeMiddle, geometry.getVertices());
            if (distance > maxMatchDistanceMeters) {
                continue;
            }
            double linkBearing = bearingDegrees(
                    geometry.getVertices().get(0),
                    geometry.getVertices().get(geometry.getVertices().size() - 1)
            );
            double bearingPenalty = bidirectionalBearingDiffDegrees(routeBearing, linkBearing);
            if (bearingPenalty > maxBearingDiffDegrees) {
                continue;
            }
            double linkLengthMeters = polylineLengthMeters(geometry.getVertices());
            candidates.add(new CandidateLink(link, geometry, distance, linkBearing, bearingPenalty, linkLengthMeters));
        }

        return candidates;
    }

    private double candidateScore(CandidateLink candidate) {
        return candidate.matchDistanceMeters() + candidate.bearingPenalty() * 0.35;
    }

    private String bestAxisCd(List<CandidateLink> candidates) {
        return candidates.stream()
                .collect(Collectors.groupingBy(candidate -> candidate.link().getAxisCd()))
                .entrySet()
                .stream()
                .min(Comparator.comparingDouble(entry -> axisScore(entry.getValue())))
                .map(Map.Entry::getKey)
                .orElse(null);
    }

    private double axisScore(List<CandidateLink> candidates) {
        double avgDistance = candidates.stream()
                .mapToDouble(CandidateLink::matchDistanceMeters)
                .average()
                .orElse(Double.MAX_VALUE);
        double avgBearingPenalty = candidates.stream()
                .mapToDouble(CandidateLink::bearingPenalty)
                .average()
                .orElse(90.0);
        return avgDistance + avgBearingPenalty * 0.35 - Math.min(candidates.size(), 8) * 4.0;
    }

    private MasterCache loadMasterCache() {
        MasterCache current = masterCache;
        long now = System.currentTimeMillis();
        if (current != null && now - current.loadedAtMs() < masterCacheTtlMs) {
            return current;
        }

        synchronized (this) {
            current = masterCache;
            now = System.currentTimeMillis();
            if (current != null && now - current.loadedAtMs() < masterCacheTtlMs) {
                return current;
            }

            Map<String, TopisRoadAxisEntity> axesByAxisCd = roadAxisRepository.findAll().stream()
                    .filter(axis -> axis.getAxisCd() != null && !axis.getAxisCd().isBlank())
                    .collect(Collectors.toMap(TopisRoadAxisEntity::getAxisCd, Function.identity(), (a, b) -> a, LinkedHashMap::new));

            Map<String, TopisAxisLinkEntity> axisLinksByLinkId = axisLinkRepository.findAll().stream()
                    .filter(link -> link.getLinkId() != null && !link.getLinkId().isBlank())
                    .collect(Collectors.toMap(TopisAxisLinkEntity::getLinkId, Function.identity(), (a, b) -> a, LinkedHashMap::new));

            Map<String, TopisLinkGeometry> geometriesByLinkId = loadDbGeometries();
            if (geometriesByLinkId.isEmpty() && !axisLinksByLinkId.isEmpty()) {
                try {
                    geometriesByLinkId = topisApiService.fetchLinkGeometries(axisLinksByLinkId.keySet());
                } catch (Exception e) {
                    log.debug("TOPIS link geometry fallback failed: {}", e.getMessage());
                    geometriesByLinkId = Map.of();
                }
            }

            current = new MasterCache(axesByAxisCd, axisLinksByLinkId, geometriesByLinkId, now);
            masterCache = current;
            return current;
        }
    }

    private Map<String, TopisLinkGeometry> loadDbGeometries() {
        List<TopisLinkVertexEntity> vertices = linkVertexRepository.findAllByOrderByIdLinkIdAscIdVerSeqAsc();
        if (vertices.isEmpty()) {
            return Map.of();
        }

        Map<String, List<GeoPoint>> grouped = new LinkedHashMap<>();
        for (TopisLinkVertexEntity vertex : vertices) {
            if (vertex.getId() == null || vertex.getId().getLinkId() == null
                    || vertex.getLat() == null || vertex.getLon() == null) {
                continue;
            }
            grouped.computeIfAbsent(vertex.getId().getLinkId(), ignored -> new ArrayList<>())
                    .add(new GeoPoint(vertex.getLat(), vertex.getLon()));
        }

        Map<String, TopisLinkGeometry> geometries = new LinkedHashMap<>();
        grouped.forEach((linkId, points) -> geometries.put(linkId, TopisLinkGeometry.builder()
                .linkId(linkId)
                .vertices(points)
                .build()));
        return geometries;
    }
    private List<RouteNode> routeNodes(Object raw) {
        if (!(raw instanceof List<?> rawNodes)) {
            return List.of();
        }

        List<RouteNode> result = new ArrayList<>();
        for (Object item : rawNodes) {
            if (!(item instanceof Map<?, ?> nodeMap)) {
                continue;
            }

            String intNo = stringValue(nodeMap, "intNo");
            String intNm = stringValue(nodeMap, "intNm");
            Double lon = doubleValue(nodeMap, "lon");
            Double lat = doubleValue(nodeMap, "lat");

            if ((lon == null || lat == null) && intNo != null && !intNo.isBlank()) {
                SignalCrossroadEntity crossroad = signalCrossroadRepository.findById(intNo).orElse(null);
                if (crossroad != null) {
                    if (intNm == null || intNm.isBlank()) {
                        intNm = crossroad.getIntNm();
                    }
                    lon = parseCoord(crossroad.getXCoord());
                    lat = parseCoord(crossroad.getYCoord());
                }
            }

            if (lon == null || lat == null) {
                continue;
            }
            result.add(new RouteNode(intNo, intNm, new GeoPoint(lat, lon)));
        }

        return result;
    }

    private Map<String, Object> summary(List<Double> speeds, Bottleneck bottleneck) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("realTime", !speeds.isEmpty());
        summary.put("avgSpeedKph", average(speeds));
        summary.put("minSpeedKph", min(speeds));
        if (bottleneck != null) {
            summary.put("bottleneckLinkId", bottleneck.linkId());
            summary.put("bottleneckAxisDir", bottleneck.axisDir());
            summary.put("bottleneckSpeedKph", bottleneck.speedKph());
        }
        return summary;
    }

    private List<Map<String, Object>> verticesPayload(Collection<GeoPoint> vertices) {
        if (vertices == null || vertices.isEmpty()) {
            return List.of();
        }
        return vertices.stream()
                .map(vertex -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("lat", vertex.getLat());
                    item.put("lon", vertex.getLon());
                    return item;
                })
                .toList();
    }

    private static double polylineLengthMeters(List<GeoPoint> vertices) {
        if (vertices == null || vertices.size() < 2) {
            return 0.0;
        }
        double total = 0.0;
        for (int i = 0; i < vertices.size() - 1; i++) {
            total += GeoDistanceUtils.haversineMeters(vertices.get(i), vertices.get(i + 1));
        }
        return total;
    }

    private static GeoPoint interpolate(GeoPoint from, GeoPoint to, double ratio) {
        return new GeoPoint(
                from.getLat() + (to.getLat() - from.getLat()) * ratio,
                from.getLon() + (to.getLon() - from.getLon()) * ratio
        );
    }

    private static double bearingDegrees(GeoPoint from, GeoPoint to) {
        double lat1 = Math.toRadians(from.getLat());
        double lat2 = Math.toRadians(to.getLat());
        double dLon = Math.toRadians(to.getLon() - from.getLon());
        double y = Math.sin(dLon) * Math.cos(lat2);
        double x = Math.cos(lat1) * Math.sin(lat2)
                - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        return (Math.toDegrees(Math.atan2(y, x)) + 360.0) % 360.0;
    }

    private static double angleDiffDegrees(double a, double b) {
        double diff = Math.abs(((a - b + 540.0) % 360.0) - 180.0);
        return Math.min(diff, 360.0 - diff);
    }

    private static double bidirectionalBearingDiffDegrees(double routeBearing, double linkBearing) {
        double sameDirection = angleDiffDegrees(routeBearing, linkBearing);
        double oppositeDirection = angleDiffDegrees((routeBearing + 180.0) % 360.0, linkBearing);
        return Math.min(sameDirection, oppositeDirection);
    }

    private static Double average(List<Double> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        return Math.round(values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0) * 10.0) / 10.0;
    }

    private static Double min(List<Double> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        return Math.round(values.stream().mapToDouble(Double::doubleValue).min().orElse(0.0) * 10.0) / 10.0;
    }

    private static Double round1(double value) {
        if (!Double.isFinite(value)) {
            return null;
        }
        return Math.round(value * 10.0) / 10.0;
    }

    private static String trafficRoadType(TopisRoadAxisEntity axis) {
        if (axis == null) {
            return "\uC2DC\uB0B4\uB3C4\uB85C";
        }
        if ("02".equals(String.valueOf(axis.getRoadDivCd()).trim())) {
            return "\uB3C4\uC2DC\uACE0\uC18D\uB3C4\uB85C";
        }
        return "\uC2DC\uB0B4\uB3C4\uB85C";
    }

    private static String generalRoadCongestion(Double speedKph, Object roadDivCd) {
        if (speedKph == null) {
            return "\uC815\uBCF4\uC5C6\uC74C";
        }
        if (speedKph < 15.0) {
            return "\uC815\uCCB4";
        }
        if (speedKph < 25.0) {
            return "\uC11C\uD589";
        }
        return "\uC6D0\uD65C";
    }

    private static String congestion(Double speedKph) {
        if (speedKph == null) {
            return "미확인";
        }
        if (speedKph <= 15.0) {
            return "정체";
        }
        if (speedKph < 25.0) {
            return "서행";
        }
        return "원활";
    }


    private static String directionKey(String axisDir) {
        String direction = safeDirection(axisDir).trim();
        if ("\uC0C1\uD589".equals(direction)) {
            return "up";
        }
        if ("\uD558\uD589".equals(direction)) {
            return "down";
        }
        return null;
    }

    private static String safeDirection(String axisDir) {
        return axisDir == null || axisDir.isBlank() ? "미확인" : axisDir;
    }

    private static String stringValue(Map<?, ?> map, String key) {
        Object value = map == null ? null : map.get(key);
        return value == null ? null : String.valueOf(value).trim();
    }

    private static Double doubleValue(Map<?, ?> map, String key) {
        Object value = map == null ? null : map.get(key);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        if (value == null || String.valueOf(value).isBlank()) {
            return null;
        }
        try {
            return Double.parseDouble(String.valueOf(value).trim());
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static Double parseCoord(String value) {
        try {
            if (value == null || value.isBlank()) {
                return null;
            }
            return Double.parseDouble(value) / 10_000_000.0;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private record RouteNode(String intNo, String intNm, GeoPoint point) {
    }

    private record ManagedCrossroad(String intNo, String intNm, GeoPoint point) {
    }

    private record ManagedEndpoint(ManagedCrossroad crossroad, double distanceMeters) {
    }

    private record ManagedTrafficCache(
            int crossroadCount,
            List<Map<String, Object>> links,
            Set<String> linkIds,
            long loadedAtMs,
            String reason
    ) {
    }

    private record CandidateLink(
            TopisAxisLinkEntity link,
            TopisLinkGeometry geometry,
            double matchDistanceMeters,
            double bearingDegrees,
            double bearingPenalty,
            double linkLengthMeters
    ) {
    }

    private record Bottleneck(String linkId, String axisDir, double speedKph) {
    }

    private record SegmentResult(Map<String, Object> payload, List<Double> speedValues, Bottleneck bottleneck) {
    }

    private record LinkResult(Map<String, Object> payload, List<Double> speedValues, Bottleneck bottleneck) {
    }

    private record MasterCache(
            Map<String, TopisRoadAxisEntity> axesByAxisCd,
            Map<String, TopisAxisLinkEntity> axisLinksByLinkId,
            Map<String, TopisLinkGeometry> geometriesByLinkId,
            long loadedAtMs
    ) {
    }

    private Map<String, Object> buildVehicleMovements(List<RouteNode> nodes, List<Map<String, Object>> segments) {
        Map<String, Object> result = new LinkedHashMap<>();

        for (int i = 1; i < nodes.size(); i++) {
            RouteNode node = nodes.get(i);

            Map<String, Object> incomingSegment = i - 1 < segments.size() ? segments.get(i - 1) : null;
            Map<String, Object> outgoingSegment = i < segments.size() ? segments.get(i) : null;

            Double approachBearing = selectedLinkBearingNearNode(incomingSegment, node.point(), i > 0 ? nodes.get(i - 1).point() : null, node.point());
            Double exitBearing = selectedLinkBearingNearNode(outgoingSegment, node.point(), node.point(), i + 1 < nodes.size() ? nodes.get(i + 1).point() : null);

            if (approachBearing == null && exitBearing == null) continue;

            Map<String, Object> movement = new LinkedHashMap<>();
            movement.put("intNo", node.intNo());
            movement.put("intNm", node.intNm());

            if (approachBearing != null) {
                movement.put("approachBearing", Math.round(approachBearing));
                movement.put("from", oppositeCompass(angleToCompass(approachBearing)));
            }

            if (exitBearing != null) {
                movement.put("exitBearing", Math.round(exitBearing));
                movement.put("to", angleToCompass(exitBearing));
            }

            result.put(String.valueOf(node.intNo()), movement);
        }

        return result;
    }

    @SuppressWarnings("unchecked")
    private Double selectedLinkBearingNearNode(Map<String, Object> segment, GeoPoint nodePoint, GeoPoint routeFrom, GeoPoint routeTo) {
        if (segment == null) return null;

        Object selected = segment.get("selectedTraffic");
        if (!(selected instanceof Map<?, ?> selectedMap)) return null;

        Object rawVertices = selectedMap.get("vertices");
        if (!(rawVertices instanceof List<?> rawList) || rawList.size() < 2) return null;

        List<GeoPoint> vertices = new ArrayList<>();
        for (Object item : rawList) {
            if (!(item instanceof Map<?, ?> map)) continue;
            Double lat = doubleValue(map, "lat");
            Double lon = doubleValue(map, "lon");
            if (lat != null && lon != null) {
                vertices.add(new GeoPoint(lat, lon));
            }
        }

        if (vertices.size() < 2) return null;

        double bestDistance = Double.MAX_VALUE;
        double bestBearing = bearingDegrees(vertices.get(0), vertices.get(1));

        for (int i = 0; i < vertices.size() - 1; i++) {
            GeoPoint a = vertices.get(i);
            GeoPoint b = vertices.get(i + 1);
//            double distance = GeoDistanceUtils.distanceToSegmentMeters(nodePoint, a, b);
            double distance = distanceToSegmentMeters(nodePoint, a, b);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestBearing = bearingDegrees(a, b);
            }
        }

        if (routeFrom != null && routeTo != null) {
            double routeBearing = bearingDegrees(routeFrom, routeTo);
            if (angleDiffDegrees(bestBearing, routeBearing) > 90.0) {
                bestBearing = (bestBearing + 180.0) % 360.0;
            }
        }

        return bestBearing;
    }

    private static String angleToCompass(double angle) {
        double a = ((angle % 360.0) + 360.0) % 360.0;

        if (a < 15 || a >= 345) return "\uBD81";       // 북
        if (a < 75) return "\uBD81\uB3D9";             // 북동
        if (a < 105) return "\uB3D9";                  // 동
        if (a < 165) return "\uB0A8\uB3D9";            // 남동
        if (a < 195) return "\uB0A8";                  // 남
        if (a < 255) return "\uB0A8\uC11C";            // 남서
        if (a < 285) return "\uC11C";                  // 서
        if (a < 345) return "\uBD81\uC11C";            // 북서
        return "\uBD81";
    }

    private static String oppositeCompass(String compass) {
        return switch (compass) {
//            case "북" -> "남";
//            case "북동" -> "남서";
//            case "동" -> "서";
//            case "남동" -> "북서";
//            case "남" -> "북";
//            case "남서" -> "북동";
//            case "서" -> "동";
//            case "북서" -> "남동";
//            default -> null;
            case "\uBD81" -> "\uB0A8";                 // 북 -> 남
            case "\uBD81\uB3D9" -> "\uB0A8\uC11C";     // 북동 -> 남서
            case "\uB3D9" -> "\uC11C";                 // 동 -> 서
            case "\uB0A8\uB3D9" -> "\uBD81\uC11C";     // 남동 -> 북서
            case "\uB0A8" -> "\uBD81";                 // 남 -> 북
            case "\uB0A8\uC11C" -> "\uBD81\uB3D9";     // 남서 -> 북동
            case "\uC11C" -> "\uB3D9";                 // 서 -> 동
            case "\uBD81\uC11C" -> "\uB0A8\uB3D9";     // 북서 -> 남동
            default -> null;
        };
    }

    private static double distanceToSegmentMeters(GeoPoint point, GeoPoint start, GeoPoint end) {
        double metersPerDegLat = 111320.0;
        double metersPerDegLon = metersPerDegLat * Math.cos(Math.toRadians(point.getLat()));

        double px = point.getLon() * metersPerDegLon;
        double py = point.getLat() * metersPerDegLat;
        double ax = start.getLon() * metersPerDegLon;
        double ay = start.getLat() * metersPerDegLat;
        double bx = end.getLon() * metersPerDegLon;
        double by = end.getLat() * metersPerDegLat;

        double dx = bx - ax;
        double dy = by - ay;
        double lenSq = dx * dx + dy * dy;

        if (lenSq == 0.0) {
            return Math.hypot(px - ax, py - ay);
        }

        double t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0.0, Math.min(1.0, t));

        double closestX = ax + dx * t;
        double closestY = ay + dy * t;

        return Math.hypot(px - closestX, py - closestY);
    }


}
