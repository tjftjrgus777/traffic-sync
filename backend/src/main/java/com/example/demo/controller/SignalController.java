package com.example.demo.controller;

import com.example.demo.service.SignalService;
import com.example.demo.service.TopisMasterDataService;
import com.example.demo.service.TopisSimulationTrafficService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/signal")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class SignalController {

    private final SignalService signalService;
    private final TopisMasterDataService topisMasterDataService;
    private final TopisSimulationTrafficService topisSimulationTrafficService;

    // 교차로 전체 목록 (지도에 핀 표시용)
    @GetMapping("/crossroads")
    public ResponseEntity<List<Map<String, Object>>> getCrossroads() {
        return ResponseEntity.ok(signalService.getAllCrossroads());
    }

    // 교차로 클릭 시 현시구성 + 운영계획 조회
    @GetMapping("/crossroads/{intNo}")
    public ResponseEntity<Map<String, Object>> getSignalData(@PathVariable String intNo) {
        Map<String, Object> data = signalService.getSignalData(intNo);
        if (data.containsKey("error")) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(data);
    }

    // 시뮬레이션 페이지 AI 챗봇용 — 현재 시각 기준 활성 현시 + 방향 파싱 포함
    @GetMapping("/simulation/context/{intNo}")
    public ResponseEntity<Map<String, Object>> getSimulationContext(@PathVariable String intNo) {
        Map<String, Object> data = signalService.getSimulationContext(intNo);
        if (data.containsKey("error")) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(data);
    }

    @PostMapping("/topis/master/sync")
    public ResponseEntity<Map<String, Object>> syncTopisMasterData() {
        try {
            return ResponseEntity.ok(topisMasterDataService.syncMasterData());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "source", "topis-master-sync",
                    "success", false,
                    "error", e.getMessage()
            ));
        }
    }

    @GetMapping("/topis/master/status")
    public ResponseEntity<Map<String, Object>> getTopisMasterDataStatus() {
        return ResponseEntity.ok(topisMasterDataService.masterDataStatus());
    }

    @PostMapping("/simulation/route-traffic")
    public ResponseEntity<Map<String, Object>> getRouteTraffic(@RequestBody Map<String, Object> request) {
        return ResponseEntity.ok(topisSimulationTrafficService.buildRouteTraffic(request));
    }

    @GetMapping("/simulation/managed-traffic-links")
    public ResponseEntity<Map<String, Object>> getManagedTrafficLinks(
            @RequestParam(required = false) Double centerLat,
            @RequestParam(required = false) Double centerLon,
            @RequestParam(required = false) Double radiusKm
    ) {
        return ResponseEntity.ok(topisSimulationTrafficService.buildManagedTrafficLinks(centerLat, centerLon, radiusKm));
    }

    @PostMapping("/simulation/managed-traffic-link-status")
    public ResponseEntity<Map<String, Object>> getManagedTrafficLinkStatuses(@RequestBody Map<String, Object> request) {
        Object rawLinkIds = request == null ? null : request.get("linkIds");
        List<String> linkIds = rawLinkIds instanceof List<?> list
                ? list.stream()
                .map(item -> item == null ? null : String.valueOf(item))
                .filter(item -> item != null && !item.isBlank())
                .toList()
                : List.of();
        return ResponseEntity.ok(topisSimulationTrafficService.buildManagedTrafficLinkStatuses(linkIds));
    }
}
