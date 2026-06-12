package com.example.demo.service;

import com.example.demo.entity.CrossroadDirectionLinkEntity;
import com.example.demo.entity.CrossroadDirectionLinkId;
import com.example.demo.entity.CrossroadSupplementalMappingEntity;
import com.example.demo.entity.TopisLinkVertexEntity;
import com.example.demo.model.CrossroadInfo;
import com.example.demo.model.context.CrossroadRoadLinkMapping;
import com.example.demo.model.context.GeoPoint;
import com.example.demo.model.context.TopisLinkGeometry;
import com.example.demo.repository.CrossroadDirectionLinkRepository;
import com.example.demo.repository.CrossroadSupplementalMappingRepository;
import com.example.demo.repository.TopisLinkVertexRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class CrossroadSupplementalMappingService {

    private final CrossroadSupplementalMappingRepository mappingRepository;
    private final CrossroadDirectionLinkRepository directionLinkRepository;
    private final TopisApiService topisApiService;
    private final RoadLinkMappingService roadLinkMappingService;
    private final TopisLinkVertexRepository topisLinkVertexRepository;

    public Map<String, CrossroadRoadLinkMapping> loadOrCreateRiskMappings(List<CrossroadInfo> crossroads) {
        return loadOrCreateMappings(crossroads);
    }

    public Map<String, CrossroadRoadLinkMapping> loadOrCreateMappings(List<CrossroadInfo> crossroads) {
        Map<String, CrossroadRoadLinkMapping> result = new LinkedHashMap<>();
        if (crossroads == null || crossroads.isEmpty()) {
            return result;
        }

        Map<String, CrossroadInfo> crossroadsById = crossroads.stream()
                .filter(crossroad -> crossroad.getCrsrdId() != null && !crossroad.getCrsrdId().isBlank())
                .collect(Collectors.toMap(CrossroadInfo::getCrsrdId, Function.identity(), (a, b) -> a, LinkedHashMap::new));
        if (crossroadsById.isEmpty()) {
            return result;
        }

        Map<String, CrossroadSupplementalMappingEntity> existingByCrossroadId =
                mappingRepository.findByCrsrdIdIn(crossroadsById.keySet()).stream()
                        .collect(Collectors.toMap(CrossroadSupplementalMappingEntity::getCrsrdId, Function.identity()));

        Map<String, CrossroadSupplementalMappingEntity> entitiesToSave = new LinkedHashMap<>();
        Map<String, TopisLinkGeometry> dbGeometries = loadDbLinkGeometries();
        if (!dbGeometries.isEmpty()) {
            log.info("Using DB TOPIS_LINK_VERTEX geometries for supplemental mapping: links={}", dbGeometries.size());
            Map<String, CrossroadRoadLinkMapping> dbMappings =
                    roadLinkMappingService.mapCrossroadsToNearestLinks(crossroadsById.values().stream().toList(), dbGeometries.values());
            for (CrossroadRoadLinkMapping mapping : dbMappings.values()) {
                CrossroadSupplementalMappingEntity entity = toEntity(
                        existingByCrossroadId.get(mapping.getCrsrdId()),
                        mapping,
                        crossroadsById.get(mapping.getCrsrdId()),
                        true);
                entitiesToSave.put(entity.getCrsrdId(), entity);
                result.put(mapping.getCrsrdId(), toMapping(entity));
            }

            int retainedExistingCount = 0;
            for (CrossroadInfo crossroad : crossroadsById.values()) {
                if (result.containsKey(crossroad.getCrsrdId())) {
                    continue;
                }
                CrossroadSupplementalMappingEntity entity = existingByCrossroadId.get(crossroad.getCrsrdId());
                if (applyGuName(entity, crossroad)) {
                    entitiesToSave.put(entity.getCrsrdId(), entity);
                }
                if (hasAnyMapping(entity)) {
                    result.put(crossroad.getCrsrdId(), toMapping(entity));
                    retainedExistingCount++;
                }
            }

            if (!entitiesToSave.isEmpty()) {
                mappingRepository.saveAll(entitiesToSave.values());
            }

            log.info("Crossroad supplemental mappings ready: requested={}, source=db-topis-link-vertex, rebuilt={}, retainedExisting={}, mapped={}",
                    crossroadsById.size(), dbMappings.size(), retainedExistingCount, result.size());
            return result;
        }

        List<CrossroadInfo> incompleteMappings = new ArrayList<>();
        int dbHitCount = 0;
        int partialDbHitCount = 0;
        for (CrossroadInfo crossroad : crossroadsById.values()) {
            CrossroadSupplementalMappingEntity entity = existingByCrossroadId.get(crossroad.getCrsrdId());
            if (applyGuName(entity, crossroad)) {
                entitiesToSave.put(entity.getCrsrdId(), entity);
            }
            if (hasCompleteMapping(entity)) {
                result.put(crossroad.getCrsrdId(), toMapping(entity));
                dbHitCount++;
            } else {
                if (hasAnyMapping(entity)) {
                    result.put(crossroad.getCrsrdId(), toMapping(entity));
                    partialDbHitCount++;
                }
                incompleteMappings.add(crossroad);
            }
        }

        int createdCount = 0;
        if (!incompleteMappings.isEmpty()) {
            Map<String, CrossroadRoadLinkMapping> createdMappings = createNearestLinkMappings(incompleteMappings);
            for (CrossroadRoadLinkMapping mapping : createdMappings.values()) {
                CrossroadSupplementalMappingEntity entity =
                        toEntity(existingByCrossroadId.get(mapping.getCrsrdId()), mapping, crossroadsById.get(mapping.getCrsrdId()));
                entitiesToSave.put(entity.getCrsrdId(), entity);
                result.put(mapping.getCrsrdId(), toMapping(entity));
            }
            createdCount = createdMappings.size();
        }

        if (!entitiesToSave.isEmpty()) {
            mappingRepository.saveAll(entitiesToSave.values());
        }

        log.info("Crossroad supplemental mappings ready: requested={}, dbHit={}, partialDbHit={}, created={}, mapped={}",
                crossroadsById.size(), dbHitCount, partialDbHitCount, createdCount, result.size());
        return result;
    }

    private Map<String, CrossroadRoadLinkMapping> createNearestLinkMappings(List<CrossroadInfo> crossroads) {
        try {
            if (!topisApiService.hasLinkGeometrySource()) {
                log.debug("TOPIS link geometry source not configured; supplemental link mapping skipped");
                return Map.of();
            }
            Map<String, TopisLinkGeometry> geometries = topisApiService.fetchAllLinkGeometries();
            log.info("Using fallback TOPIS link geometries for supplemental mapping: links={}", geometries.size());
            return roadLinkMappingService.mapCrossroadsToNearestLinks(crossroads, geometries.values());
        } catch (Exception e) {
            log.warn("Crossroad supplemental mapping creation failed: {}", e.getMessage());
            return Map.of();
        }
    }

    /**
     * 교차로별 방향(nt/et/st/wt/ne/se/sw/nw) 진입 링크 매핑을 계산해 저장하고 반환한다.
     *
     * <p>분류가 각 교차로의 실제 V2X 신호 방향({@code availableDirectionsByCrossroad})에 의존하므로
     * 호출 시마다 다시 계산하고 기존 행을 교체한다(replace). 신호 방향 정보가 갱신되면
     * 매핑도 정확히 갱신된다.
     *
     * @param availableDirectionsByCrossroad 교차로별 실제 신호 방향 코드 집합. null/빈 값이면 8방위로 분류.
     */
    public Map<String, Map<String, CrossroadRoadLinkMapping>> loadOrCreateDirectionalMappings(
            List<CrossroadInfo> crossroads,
            Map<String, Set<String>> availableDirectionsByCrossroad
    ) {
        Map<String, Map<String, CrossroadRoadLinkMapping>> result = new LinkedHashMap<>();
        if (crossroads == null || crossroads.isEmpty()) {
            return result;
        }

        Map<String, CrossroadInfo> crossroadsById = crossroads.stream()
                .filter(crossroad -> crossroad.getCrsrdId() != null && !crossroad.getCrsrdId().isBlank())
                .collect(Collectors.toMap(CrossroadInfo::getCrsrdId, Function.identity(), (a, b) -> a, LinkedHashMap::new));
        if (crossroadsById.isEmpty()) {
            return result;
        }

        Map<String, TopisLinkGeometry> dbGeometries = loadDbLinkGeometries();
        if (dbGeometries.isEmpty()) {
            log.warn("Directional mapping skipped for {} crossroads: TOPIS_LINK_VERTEX geometries empty", crossroadsById.size());
            return result;
        }

        Map<String, Map<String, CrossroadRoadLinkMapping>> computed =
                roadLinkMappingService.mapCrossroadsToDirectionalLinks(
                        crossroadsById.values().stream().toList(),
                        dbGeometries.values(),
                        availableDirectionsByCrossroad);

        // 재계산 결과로 교체: 기존 행 삭제 후 새로 저장.
        directionLinkRepository.deleteByIdCrsrdIdIn(crossroadsById.keySet());

        List<CrossroadDirectionLinkEntity> entitiesToSave = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Map<String, CrossroadRoadLinkMapping>> entry : computed.entrySet()) {
            entry.getValue().forEach((direction, mapping) ->
                    entitiesToSave.add(toDirectionEntity(entry.getKey(), direction, mapping, now)));
            result.put(entry.getKey(), entry.getValue());
        }
        if (!entitiesToSave.isEmpty()) {
            directionLinkRepository.saveAll(entitiesToSave);
        }

        log.info("Crossroad directional mappings ready: requested={}, mapped={}, links={}",
                crossroadsById.size(), result.size(), entitiesToSave.size());
        return result;
    }

    private CrossroadRoadLinkMapping toDirectionalMapping(CrossroadDirectionLinkEntity entity) {
        return CrossroadRoadLinkMapping.builder()
                .crsrdId(entity.getId().getCrsrdId())
                .directionCode(entity.getId().getDirectionCode())
                .linkId(entity.getLinkId())
                .speedLinkId(entity.getLinkId())
                .distanceMeters(entity.getDistanceMeters() == null ? 0.0 : entity.getDistanceMeters())
                .bearingDegrees(entity.getBearingDegrees())
                .build();
    }

    private CrossroadDirectionLinkEntity toDirectionEntity(
            String crsrdId,
            String directionCode,
            CrossroadRoadLinkMapping mapping,
            long updatedAtMs
    ) {
        CrossroadDirectionLinkEntity entity = new CrossroadDirectionLinkEntity();
        entity.setId(new CrossroadDirectionLinkId(crsrdId, directionCode));
        entity.setLinkId(firstNonBlank(mapping.getSpeedLinkId(), mapping.getLinkId()));
        entity.setDistanceMeters(mapping.getDistanceMeters());
        entity.setBearingDegrees(mapping.getBearingDegrees());
        entity.setUpdatedAtMs(updatedAtMs);
        return entity;
    }

    private Map<String, TopisLinkGeometry> loadDbLinkGeometries() {
        List<TopisLinkVertexEntity> vertices = topisLinkVertexRepository.findAllByOrderByIdLinkIdAscIdVerSeqAsc();
        if (vertices == null || vertices.isEmpty()) {
            return Map.of();
        }

        Map<String, List<GeoPoint>> grouped = new LinkedHashMap<>();
        for (TopisLinkVertexEntity vertex : vertices) {
            if (vertex == null
                    || vertex.getId() == null
                    || isBlank(vertex.getId().getLinkId())
                    || vertex.getLat() == null
                    || vertex.getLon() == null) {
                continue;
            }
            grouped.computeIfAbsent(vertex.getId().getLinkId(), ignored -> new ArrayList<>())
                    .add(new GeoPoint(vertex.getLat(), vertex.getLon()));
        }

        Map<String, TopisLinkGeometry> geometries = new LinkedHashMap<>();
        grouped.forEach((linkId, points) -> {
            if (points.size() >= 2) {
                geometries.put(linkId, TopisLinkGeometry.builder()
                        .linkId(linkId)
                        .vertices(points)
                        .build());
            }
        });
        return geometries;
    }

    private CrossroadSupplementalMappingEntity toEntity(
            CrossroadSupplementalMappingEntity current,
            CrossroadRoadLinkMapping mapping,
            CrossroadInfo crossroad
    ) {
        return toEntity(current, mapping, crossroad, false);
    }

    private CrossroadSupplementalMappingEntity toEntity(
            CrossroadSupplementalMappingEntity current,
            CrossroadRoadLinkMapping mapping,
            CrossroadInfo crossroad,
            boolean replaceExistingMapping
    ) {
        CrossroadSupplementalMappingEntity entity = current == null ? new CrossroadSupplementalMappingEntity() : current;
        boolean hasRiskMapping = hasRiskMapping(entity);
        boolean hasSpeedMapping = hasSpeedMapping(entity);

        entity.setCrsrdId(mapping.getCrsrdId());
        applyGuName(entity, crossroad);

        if (replaceExistingMapping || !hasRiskMapping) {
            entity.setRiskSourceLinkId(mapping.getLinkId());
            entity.setRiskLineString(mapping.getLineString());
            entity.setRiskDistanceMeters(mapping.getDistanceMeters());
        } else {
            if (isBlank(entity.getRiskSourceLinkId())) {
                entity.setRiskSourceLinkId(mapping.getLinkId());
            }
            if (entity.getRiskDistanceMeters() == null) {
                entity.setRiskDistanceMeters(mapping.getDistanceMeters());
            }
        }

        String speedLinkId = firstNonBlank(mapping.getSpeedLinkId(), mapping.getLinkId());
        if (replaceExistingMapping || !hasSpeedMapping) {
            entity.setSpeedLinkId(speedLinkId);
            entity.setSpeedDistanceMeters(mapping.getSpeedDistanceMeters() == null
                    ? mapping.getDistanceMeters()
                    : mapping.getSpeedDistanceMeters());
        } else if (entity.getSpeedDistanceMeters() == null) {
            entity.setSpeedDistanceMeters(mapping.getSpeedDistanceMeters() == null
                    ? mapping.getDistanceMeters()
                    : mapping.getSpeedDistanceMeters());
        }

        entity.setUpdatedAtMs(System.currentTimeMillis());
        return entity;
    }

    private CrossroadRoadLinkMapping toMapping(CrossroadSupplementalMappingEntity entity) {
        return CrossroadRoadLinkMapping.builder()
                .crsrdId(entity.getCrsrdId())
                .linkId(entity.getRiskSourceLinkId())
                .lineString(entity.getRiskLineString())
                .distanceMeters(entity.getRiskDistanceMeters() == null ? 0.0 : entity.getRiskDistanceMeters())
                .speedLinkId(entity.getSpeedLinkId())
                .speedDistanceMeters(entity.getSpeedDistanceMeters())
                .build();
    }

    private boolean applyGuName(CrossroadSupplementalMappingEntity entity, CrossroadInfo crossroad) {
        if (entity == null || crossroad == null || isBlank(crossroad.getGuName())) {
            return false;
        }
        String guName = crossroad.getGuName().trim();
        if (guName.equals(entity.getGuName())) {
            return false;
        }
        entity.setGuName(guName);
        entity.setUpdatedAtMs(System.currentTimeMillis());
        return true;
    }

    private boolean hasRiskMapping(CrossroadSupplementalMappingEntity entity) {
        return entity != null
                && entity.getRiskLineString() != null
                && !entity.getRiskLineString().isBlank()
                && !isLegacyWideRiskLineString(entity.getRiskLineString());
    }

    private boolean hasSpeedMapping(CrossroadSupplementalMappingEntity entity) {
        return entity != null
                && entity.getSpeedLinkId() != null
                && !entity.getSpeedLinkId().isBlank();
    }

    private boolean hasCompleteMapping(CrossroadSupplementalMappingEntity entity) {
        return hasRiskMapping(entity) && hasSpeedMapping(entity);
    }

    private boolean hasAnyMapping(CrossroadSupplementalMappingEntity entity) {
        return hasRiskMapping(entity) || hasSpeedMapping(entity);
    }

    private String firstNonBlank(String first, String second) {
        if (!isBlank(first)) {
            return first;
        }
        return second;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private boolean isLegacyWideRiskLineString(String lineString) {
        return RoadRiskApiService.lineStringCoordinateCount(lineString) != 2
                || RoadRiskApiService.estimateLineStringLengthMeters(lineString) > 120.0;
    }
}
