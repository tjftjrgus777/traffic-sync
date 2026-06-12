package com.example.demo.service;

import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.model.context.GeoPoint;
import com.example.demo.model.context.TopisLinkGeometry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
public class RoadLinkMappingService {

    private static final String[] DIRECTION_CODES = {"nt", "ne", "et", "se", "st", "sw", "wt", "nw"};

    @Value("${road-link.max-match-distance-meters:150}")
    private double maxMatchDistanceMeters;

    @Value("${road-risk.local-line-length-meters:60}")
    private double roadRiskLocalLineLengthMeters;

    public Map<String, CrossroadRoadLinkMapping> mapCrossroadsToNearestLinks(
            List<CrossroadInfo> crossroads,
            Collection<TopisLinkGeometry> geometries
    ) {
        Map<String, CrossroadRoadLinkMapping> result = new LinkedHashMap<>();
        if (crossroads == null || crossroads.isEmpty() || geometries == null || geometries.isEmpty()) {
            return result;
        }

        for (CrossroadInfo crossroad : crossroads) {
            GeoPoint crossroadPoint = new GeoPoint(crossroad.getLat(), crossroad.getLon());
            TopisLinkGeometry bestGeometry = null;
            double bestDistance = Double.MAX_VALUE;

            for (TopisLinkGeometry geometry : geometries) {
                double distance = GeoDistanceUtils.distanceToPolylineMeters(crossroadPoint, geometry.getVertices());
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestGeometry = geometry;
                }
            }

            if (bestGeometry == null || bestDistance > maxMatchDistanceMeters) {
                log.debug("TOPIS link match failed: {} ({}) nearest={}m",
                        crossroad.getCrsrdNm(), crossroad.getCrsrdId(), Math.round(bestDistance));
                continue;
            }

            result.put(crossroad.getCrsrdId(), CrossroadRoadLinkMapping.builder()
                    .crsrdId(crossroad.getCrsrdId())
                    .linkId(bestGeometry.getLinkId())
                    .speedLinkId(bestGeometry.getLinkId())
                    .distanceMeters(bestDistance)
                    .speedDistanceMeters(bestDistance)
                    .vertices(bestGeometry.getVertices())
                    .lineString(RoadRiskApiService.buildLineStringNearPoint(
                            bestGeometry.getVertices(), crossroadPoint, roadRiskLocalLineLengthMeters))
                    .build());
        }

        log.info("Crossroad-TOPIS nearest link mapping completed: {} / {}", result.size(), crossroads.size());
        return result;
    }

    // 신호 방향 코드별 공칭 방위각(나침반 기준).
    private static final Map<String, Double> NOMINAL_BEARINGS = Map.of(
            "nt", 0.0, "ne", 45.0, "et", 90.0, "se", 135.0,
            "st", 180.0, "sw", 225.0, "wt", 270.0, "nw", 315.0);

    // 진입 방향을 신호 방향에 스냅할 때 허용하는 최대 각도 차이.
    private static final double SNAP_TOLERANCE_DEGREES = 67.5;

    /**
     * 교차로별 방향(nt/et/st/wt/ne/se/sw/nw) 진입 링크를 매핑한다.
     *
     * <p>분류 기준은 "링크가 뻗어 있는 방향(먼 끝점 방위 = 차량이 진입해 오는 방향)"이다.
     * 링크가 교차로 바로 위에 있을 때 최근접점 방위가 무의미해지는 문제를 피한다.
     *
     * <p>{@code availableDirectionsByCrossroad}가 주어지면 진입 방향을 그 교차로가 실제 가진
     * V2X 신호 방향에 스냅한다. 실제 도로가 정북/정동에서 틀어져 있어도 화면 신호 칸과
     * 키가 정확히 일치하게 된다. 신호 정보가 없으면 8방위 그대로 분류한다.
     */
    public Map<String, Map<String, CrossroadRoadLinkMapping>> mapCrossroadsToDirectionalLinks(
            List<CrossroadInfo> crossroads,
            Collection<TopisLinkGeometry> geometries,
            Map<String, Set<String>> availableDirectionsByCrossroad
    ) {
        Map<String, Map<String, CrossroadRoadLinkMapping>> result = new LinkedHashMap<>();
        if (crossroads == null || crossroads.isEmpty() || geometries == null || geometries.isEmpty()) {
            return result;
        }

        for (CrossroadInfo crossroad : crossroads) {
            GeoPoint crossroadPoint = new GeoPoint(crossroad.getLat(), crossroad.getLon());
            Set<String> availableDirections = availableDirectionsByCrossroad == null
                    ? null
                    : availableDirectionsByCrossroad.get(crossroad.getCrsrdId());
            Map<String, DirectionalCandidate> byDirection = new LinkedHashMap<>();

            for (TopisLinkGeometry geometry : geometries) {
                List<GeoPoint> vertices = geometry.getVertices();
                if (vertices == null || vertices.size() < 2) {
                    continue;
                }

                GeoDistanceUtils.ClosestPoint closest =
                        GeoDistanceUtils.closestPointOnPolyline(crossroadPoint, vertices);
                if (closest.distanceMeters() > maxMatchDistanceMeters) {
                    continue;
                }

                // 차량이 진입해 오는 방향 = 링크가 교차로에서 멀리 뻗은 쪽.
                double approachBearing = approachBearing(crossroadPoint, vertices);
                String directionCode = (availableDirections != null && !availableDirections.isEmpty())
                        ? snapToAvailableDirection(approachBearing, availableDirections)
                        : directionCodeForBearing(approachBearing);
                if (directionCode == null) {
                    continue;
                }

                boolean inbound = isInbound(crossroadPoint, vertices);

                CrossroadRoadLinkMapping candidate = CrossroadRoadLinkMapping.builder()
                        .crsrdId(crossroad.getCrsrdId())
                        .directionCode(directionCode)
                        .linkId(geometry.getLinkId())
                        .speedLinkId(geometry.getLinkId())
                        .distanceMeters(closest.distanceMeters())
                        .speedDistanceMeters(closest.distanceMeters())
                        .bearingDegrees(approachBearing)
                        .vertices(vertices)
                        .lineString(RoadRiskApiService.buildLineStringNearPoint(
                                vertices, crossroadPoint, roadRiskLocalLineLengthMeters))
                        .build();

                DirectionalCandidate current = byDirection.get(directionCode);
                DirectionalCandidate next = new DirectionalCandidate(candidate, inbound, closest.distanceMeters());
                // 진입 링크 우선, 같은 조건이면 더 가까운 링크 선택.
                if (current == null || next.isBetterThan(current)) {
                    byDirection.put(directionCode, next);
                }
            }

            if (!byDirection.isEmpty()) {
                Map<String, CrossroadRoadLinkMapping> resolved = new LinkedHashMap<>();
                byDirection.forEach((direction, candidate) -> resolved.put(direction, candidate.mapping()));
                result.put(crossroad.getCrsrdId(), resolved);
            }
        }

        log.info("Crossroad-TOPIS directional link mapping completed: {} / {}", result.size(), crossroads.size());
        return result;
    }

    // 차량이 진입해 오는 방위각 = 교차로 중심에서 링크의 먼 끝점을 바라보는 방향.
    // 끝점은 중심에서 충분히 떨어져 있어 방위가 안정적이다(중심 위 링크의 noise 회피).
    private double approachBearing(GeoPoint center, List<GeoPoint> vertices) {
        GeoPoint first = vertices.get(0);
        GeoPoint last = vertices.get(vertices.size() - 1);
        double distFirst = GeoDistanceUtils.haversineMeters(center, first);
        double distLast = GeoDistanceUtils.haversineMeters(center, last);
        GeoPoint farEnd = distFirst >= distLast ? first : last;
        return GeoDistanceUtils.bearingBetween(center, farEnd);
    }

    // 링크가 교차로로 진입하는지(끝점이 중심에 가까움) 여부. 정점 순서 = 진행방향 가정.
    private boolean isInbound(GeoPoint center, List<GeoPoint> vertices) {
        GeoPoint first = vertices.get(0);
        GeoPoint last = vertices.get(vertices.size() - 1);
        return GeoDistanceUtils.haversineMeters(center, last)
                < GeoDistanceUtils.haversineMeters(center, first);
    }

    // 진입 방위각을 그 교차로가 실제 가진 신호 방향 중 가장 가까운 것에 스냅한다.
    private String snapToAvailableDirection(double bearing, Set<String> availableDirections) {
        String best = null;
        double bestDiff = Double.MAX_VALUE;
        for (String direction : availableDirections) {
            Double nominal = NOMINAL_BEARINGS.get(direction);
            if (nominal == null) {
                continue;
            }
            double diff = angularDifference(bearing, nominal);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = direction;
            }
        }
        return bestDiff <= SNAP_TOLERANCE_DEGREES ? best : null;
    }

    private static String directionCodeForBearing(double bearingDegrees) {
        if (Double.isNaN(bearingDegrees)) {
            return null;
        }
        int sector = (int) Math.floor(((bearingDegrees + 22.5) % 360.0) / 45.0);
        return DIRECTION_CODES[sector];
    }

    // 두 방위각(0~360°) 사이의 최소 차이(0~180°).
    private static double angularDifference(double a, double b) {
        double diff = Math.abs(a - b) % 360.0;
        return diff > 180.0 ? 360.0 - diff : diff;
    }

    // 한 방향 섹터의 후보 링크. 진입 링크를 우선하고, 동일 조건이면 더 가까운 링크를 택한다.
    private record DirectionalCandidate(CrossroadRoadLinkMapping mapping, boolean inbound, double distanceMeters) {
        boolean isBetterThan(DirectionalCandidate other) {
            if (this.inbound != other.inbound) {
                return this.inbound;
            }
            return this.distanceMeters < other.distanceMeters;
        }
    }
}
