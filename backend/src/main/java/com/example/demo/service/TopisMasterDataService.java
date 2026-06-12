package com.example.demo.service;

import com.example.demo.entity.TopisAxisLinkEntity;
import com.example.demo.entity.TopisLinkVertexEntity;
import com.example.demo.entity.TopisLinkVertexId;
import com.example.demo.entity.TopisRoadAxisEntity;
import com.example.demo.entity.TopisRoadDivEntity;
import com.example.demo.model.context.TopisAxisLinkInfo;
import com.example.demo.model.context.TopisLinkVertexInfo;
import com.example.demo.model.context.TopisRoadAxisInfo;
import com.example.demo.model.context.TopisRoadDivInfo;
import com.example.demo.repository.TopisAxisLinkRepository;
import com.example.demo.repository.TopisLinkVertexRepository;
import com.example.demo.repository.TopisRoadAxisRepository;
import com.example.demo.repository.TopisRoadDivRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
@RequiredArgsConstructor
public class TopisMasterDataService {

    private final TopisApiService topisApiService;
    private final TopisRoadDivRepository roadDivRepository;
    private final TopisRoadAxisRepository roadAxisRepository;
    private final TopisAxisLinkRepository axisLinkRepository;
    private final TopisLinkVertexRepository linkVertexRepository;

    @Transactional(readOnly = true)
    public Map<String, Object> masterDataStatus() {
        long roadDivCount = roadDivRepository.count();
        long axisCount = roadAxisRepository.count();
        long axisLinkCount = axisLinkRepository.count();
        long vertexCount = linkVertexRepository.count();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("source", "topis-master-status");
        result.put("ready", isMasterDataReady(roadDivCount, axisCount, axisLinkCount, vertexCount));
        result.put("roadDivCount", roadDivCount);
        result.put("axisCount", axisCount);
        result.put("axisLinkCount", axisLinkCount);
        result.put("vertexCount", vertexCount);
        return result;
    }

    @Transactional(readOnly = true)
    public boolean hasMasterData() {
        return isMasterDataReady(
                roadDivRepository.count(),
                roadAxisRepository.count(),
                axisLinkRepository.count(),
                linkVertexRepository.count()
        );
    }

    @Transactional
    public Map<String, Object> syncMasterData() throws Exception {
        long startedAtMs = System.currentTimeMillis();
        long updatedAtMs = System.currentTimeMillis();

        List<TopisRoadDivInfo> roadDivInfos = topisApiService.fetchRoadDivInfos();
        List<TopisRoadDivEntity> roadDivEntities = roadDivInfos.stream()
                .map(info -> toRoadDivEntity(info, updatedAtMs))
                .toList();

        List<TopisRoadAxisInfo> axisInfos = new ArrayList<>();
        for (TopisRoadDivInfo roadDivInfo : roadDivInfos) {
            axisInfos.addAll(topisApiService.fetchRoadAxes(roadDivInfo.roadDivCd()));
        }
        List<TopisRoadAxisEntity> axisEntities = axisInfos.stream()
                .map(info -> toRoadAxisEntity(info, updatedAtMs))
                .toList();

        List<TopisAxisLinkInfo> axisLinkInfos = new ArrayList<>();
        for (TopisRoadAxisInfo axisInfo : axisInfos) {
            axisLinkInfos.addAll(topisApiService.fetchAxisLinks(axisInfo.axisCd()));
        }
        List<TopisAxisLinkEntity> axisLinkEntities = axisLinkInfos.stream()
                .map(info -> toAxisLinkEntity(info, updatedAtMs))
                .toList();

        List<TopisLinkVertexInfo> vertexInfos = fetchVertexInfos(axisLinkInfos);
        List<TopisLinkVertexEntity> vertices = vertexInfos.stream()
                .map(info -> toVertexEntity(info, updatedAtMs))
                .filter(Objects::nonNull)
                .toList();

        roadDivRepository.saveAll(roadDivEntities);
        roadAxisRepository.saveAll(axisEntities);
        axisLinkRepository.saveAll(axisLinkEntities);
        linkVertexRepository.saveAll(vertices);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("source", "topis-master-sync");
        result.put("roadDivCount", roadDivEntities.size());
        result.put("axisCount", axisEntities.size());
        result.put("axisLinkCount", axisLinkEntities.size());
        result.put("linkGeometryCount", vertexInfos.stream()
                .map(TopisLinkVertexInfo::linkId)
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .distinct()
                .count());
        result.put("vertexCount", vertices.size());
        result.put("elapsedMs", System.currentTimeMillis() - startedAtMs);
        result.put("updatedAtMs", updatedAtMs);

        log.info("TOPIS master sync completed: {}", result);
        return result;
    }

    private TopisRoadDivEntity toRoadDivEntity(TopisRoadDivInfo info, long updatedAtMs) {
        TopisRoadDivEntity entity = new TopisRoadDivEntity();
        entity.setRoadDivCd(info.roadDivCd());
        entity.setRoadDivNm(info.roadDivNm());
        entity.setUpdatedAtMs(updatedAtMs);
        return entity;
    }

    private TopisRoadAxisEntity toRoadAxisEntity(TopisRoadAxisInfo info, long updatedAtMs) {
        TopisRoadAxisEntity entity = new TopisRoadAxisEntity();
        entity.setRoadDivCd(info.roadDivCd());
        entity.setAxisCd(info.axisCd());
        entity.setAxisName(info.axisName());
        entity.setUpdatedAtMs(updatedAtMs);
        return entity;
    }

    private TopisAxisLinkEntity toAxisLinkEntity(TopisAxisLinkInfo info, long updatedAtMs) {
        TopisAxisLinkEntity entity = new TopisAxisLinkEntity();
        entity.setAxisCd(info.axisCd());
        entity.setAxisDir(info.axisDir());
        entity.setLinkSeq(info.linkSeq());
        entity.setLinkId(info.linkId());
        entity.setUpdatedAtMs(updatedAtMs);
        return entity;
    }

    private List<TopisLinkVertexInfo> fetchVertexInfos(List<TopisAxisLinkInfo> axisLinkInfos) throws Exception {
        List<String> linkIds = axisLinkInfos.stream()
                .map(TopisAxisLinkInfo::linkId)
                .filter(linkId -> linkId != null && !linkId.isBlank())
                .distinct()
                .toList();

        int threads = Math.min(12, Math.max(1, linkIds.size()));
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        List<TopisLinkVertexInfo> result = Collections.synchronizedList(new ArrayList<>());
        try {
            List<Callable<Void>> tasks = linkIds.stream()
                    .<Callable<Void>>map(linkId -> () -> {
                        result.addAll(topisApiService.fetchLinkVertexInfos(linkId));
                        return null;
                    })
                    .toList();
            List<Future<Void>> futures = executor.invokeAll(tasks, 30, TimeUnit.MINUTES);
            long failed = futures.stream().filter(f -> {
                try { f.get(); return false; } catch (Exception e) { return true; }
            }).count();
            if (failed > 0) {
                log.warn("TOPIS vertex fetch: {} links failed or timed out", failed);
            }
        } finally {
            executor.shutdownNow();
        }
        return new ArrayList<>(result);
    }

    private TopisLinkVertexEntity toVertexEntity(TopisLinkVertexInfo info, long updatedAtMs) {
        if (info == null || info.linkId() == null || info.linkId().isBlank()
                || info.verSeq() == null || info.lat() == null || info.lon() == null) {
            return null;
        }

        TopisLinkVertexEntity entity = new TopisLinkVertexEntity();
        entity.setId(new TopisLinkVertexId(info.linkId(), info.verSeq()));
        entity.setGrs80tmX(info.grs80tmX());
        entity.setGrs80tmY(info.grs80tmY());
        entity.setLat(info.lat());
        entity.setLon(info.lon());
        entity.setUpdatedAtMs(updatedAtMs);
        return entity;
    }

    private boolean isMasterDataReady(
            long roadDivCount,
            long axisCount,
            long axisLinkCount,
            long vertexCount
    ) {
        return roadDivCount > 0
                && axisCount > 0
                && axisLinkCount > 0
                && vertexCount > 0;
    }
}
