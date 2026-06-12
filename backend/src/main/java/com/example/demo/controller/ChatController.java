package com.example.demo.controller;

import com.example.demo.model.TrafficStatus;
import com.example.demo.service.ChatService;
import com.example.demo.service.SupplementalDataCacheService;
import com.example.demo.service.TrafficCacheService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class ChatController {

    private final TrafficCacheService cacheService;
    private final SupplementalDataCacheService supplementalDataCacheService;
    private final ChatService chatService;

    // 교차로 실시간 데이터 확인용 (디버깅)
    @GetMapping("/context/{crsrdId}")
    public ResponseEntity<TrafficStatus> getContext(@PathVariable String crsrdId) {
        TrafficStatus status = cacheService.getSignal(crsrdId);
        if (status == null) return ResponseEntity.notFound().build();
        supplementalDataCacheService.enrichTrafficStatus(status);
        return ResponseEntity.ok(status);
    }

    @PostMapping("/chat")
    public ResponseEntity<Map<String, String>> chat(@RequestBody Map<String, String> body) {
        String crsrdId = body.get("crsrdId");
        String question = body.get("question");
        String userEmail = body.get("userEmail");
        if (question == null || question.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        String answer = chatService.ask(crsrdId, question, userEmail);
        return ResponseEntity.ok(Map.of("answer", answer));
    }

    // 병목 이메일 전송 — 10km/h 이하 교차로만 필터링해서 메일 발송
    @PostMapping("/bottleneck-email")
    public ResponseEntity<Map<String, String>> bottleneckEmail(@RequestBody Map<String, String> body) {
        String district = body.get("district");
        String userEmail = body.get("userEmail");
        if (district == null || district.isBlank()) return ResponseEntity.badRequest().build();
        String result = chatService.bottleneckEmail(district, userEmail);
        return ResponseEntity.ok(Map.of("result", result));
    }

    // 시뮬레이션 페이지 챗봇 — 관제사 조정값 + 경로 속도 포함 AI 분석
    @PostMapping("/simulation-chat")
    public ResponseEntity<Map<String, Object>> simulationChat(@RequestBody Map<String, Object> body) {
        String intNo = (String) body.get("intNo");
        String question = (String) body.get("question");
        String userEmail = (String) body.get("userEmail");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> simulation = (List<Map<String, Object>>) body.get("simulation");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> routeTraffic = (List<Map<String, Object>>) body.get("routeTraffic");
        @SuppressWarnings("unchecked")
        List<String> bottleneckIntNos = (List<String>) body.get("bottleneckIntNos");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> contexts = (List<Map<String, Object>>) body.get("contexts");
        if (question == null || question.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        Map<String, Object> result = chatService.simulationChat(intNo, question, simulation, routeTraffic, bottleneckIntNos, contexts, userEmail);
        return ResponseEntity.ok(result);
    }

    // 시뮬레이션 챗 스트리밍 — Python SSE 프록시
    @PostMapping(value = "/simulation-chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> simulationChatStream(@RequestBody Map<String, Object> body) {
        String intNo = (String) body.get("intNo");
        String question = (String) body.get("question");
        String userEmail = (String) body.get("userEmail");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> simulation = (List<Map<String, Object>>) body.get("simulation");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> routeTraffic = (List<Map<String, Object>>) body.get("routeTraffic");
        @SuppressWarnings("unchecked")
        List<String> bottleneckIntNos = (List<String>) body.get("bottleneckIntNos");
        return chatService.simulationChatStream(intNo, simulation, routeTraffic, bottleneckIntNos, question, userEmail);
    }
}
