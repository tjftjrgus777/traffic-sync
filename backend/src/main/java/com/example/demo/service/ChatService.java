package com.example.demo.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class ChatService {

    private final WebClient webClient;
    private final SignalService signalService;
    private final EmailService emailService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${agent.api.url:http://localhost:8001}")
    private String agentUrl;

    // 자유 챗봇 — 지도 페이지 (교차로 선택 여부 무관)
    public String ask(String crsrdId, String question, String userEmail) {
        try {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("question", question);
            if (crsrdId != null && !crsrdId.isBlank()) {
                body.put("crsrdId", crsrdId);
            }
            if (userEmail != null && !userEmail.isBlank()) {
                body.put("userEmail", userEmail);
            }

            String response = webClient.post()
                    .uri(agentUrl + "/api/agent/chat")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode root = objectMapper.readTree(response);
            return root.path("answer").asText("응답 없음");

        } catch (WebClientResponseException e) {
            log.error("에이전트 오류 {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            return "AI 분석 실패 (" + e.getStatusCode() + ")";
        } catch (Exception e) {
            log.error("에이전트 호출 실패: {}", e.getMessage());
            return "AI 분석 중 오류가 발생했습니다.";
        }
    }

    // 시뮬레이션 페이지 챗봇 — 병목 교차로 다중 신호계획 조립 후 AI 분석
    public Map<String, Object> simulationChat(String intNo, String question, List<Map<String, Object>> simulation,
                                               List<Map<String, Object>> routeTraffic,
                                               List<String> bottleneckIntNos,
                                               List<Map<String, Object>> frontendContexts, String userEmail) {
        try {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("question", question);

            // 프론트에서 미리 fetch한 contexts가 있으면 그대로 사용 (시점 불일치 방지)
            // 없으면 DB에서 직접 조회 (fallback)
            if (frontendContexts != null && !frontendContexts.isEmpty()) {
                body.set("contexts", objectMapper.valueToTree(frontendContexts));
            } else if (bottleneckIntNos != null && !bottleneckIntNos.isEmpty()) {
                List<Map<String, Object>> contexts = new java.util.ArrayList<>();
                for (String id : bottleneckIntNos) {
                    if (id != null && !id.isBlank()) {
                        Map<String, Object> ctx = signalService.getSimulationContext(id);
                        if (ctx != null && !ctx.isEmpty()) contexts.add(ctx);
                    }
                }
                if (!contexts.isEmpty()) body.set("contexts", objectMapper.valueToTree(contexts));
            } else if (intNo != null && !intNo.isBlank()) {
                Map<String, Object> context = signalService.getSimulationContext(intNo);
                body.set("context", objectMapper.valueToTree(context));
            }

            if (simulation != null && !simulation.isEmpty()) {
                body.set("simulation", objectMapper.valueToTree(simulation));
            }
            if (routeTraffic != null && !routeTraffic.isEmpty()) {
                body.set("routeTraffic", objectMapper.valueToTree(routeTraffic));
            }
            if (userEmail != null && !userEmail.isBlank()) {
                body.put("userEmail", userEmail);
            }

            String response = webClient.post()
                    .uri(agentUrl + "/api/agent/simulation-chat")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode root = objectMapper.readTree(response);
            Map<String, Object> result = new java.util.LinkedHashMap<>();
            result.put("answer", root.path("answer").asText("응답 없음"));
            // 다중 adjustments 우선, 없으면 단일 adjustment
            JsonNode adjs = root.path("adjustments");
            if (!adjs.isMissingNode() && !adjs.isNull()) {
                result.put("adjustments", objectMapper.convertValue(adjs, Object.class));
            }
            JsonNode adj = root.path("adjustment");
            if (!adj.isMissingNode() && !adj.isNull()) {
                result.put("adjustment", objectMapper.convertValue(adj, Object.class));
            }
            JsonNode rep = root.path("report");
            String reportText = null;
            if (!rep.isMissingNode() && !rep.isNull() && !rep.asText("").isBlank()) {
                reportText = rep.asText();
                result.put("report", reportText);
            }

            // report 또는 answer 있고 userEmail 있으면 Spring이 직접 이메일 발송
            if (userEmail != null && !userEmail.isBlank() && (reportText != null || !root.path("answer").asText("").isBlank())) {
                String answer = root.path("answer").asText("");
                String now = java.time.LocalDateTime.now()
                        .format(java.time.format.DateTimeFormatter.ofPattern("yyyy년 M월 d일 HH:mm"));
                StringBuilder sb = new StringBuilder();
                sb.append("[AI 신호 자동조정 분석 보고서]\n발행일시: ").append(now).append("\n\n");
                sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                sb.append("■ 조정 요약\n");
                sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                sb.append(answer).append("\n");
                if (reportText != null) {
                    sb.append("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                    sb.append("■ 상세 분석 (Webster 공식 기반)\n");
                    sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                    sb.append(reportText).append("\n");
                }
                sb.append("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                sb.append("본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\n");
                sb.append("감사합니다.\n\n");
                sb.append("Syncro 교통 관제 시스템 드림");
                String emailBody = sb.toString();
                try {
                    emailService.send(userEmail, "[Syncro] 분석결과를 알려드립니다", emailBody);
                    log.info("[SIM-EMAIL] 발송 완료 → {}", userEmail);
                } catch (Exception emailEx) {
                    log.error("[SIM-EMAIL] 발송 실패 → {}: {}", userEmail, emailEx.getMessage());
                }
            }

            return result;

        } catch (WebClientResponseException e) {
            log.error("시뮬레이션 에이전트 오류 {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            return Map.of("answer", "AI 분석 실패 (" + e.getStatusCode() + ")");
        } catch (Exception e) {
            log.error("시뮬레이션 에이전트 호출 실패: {}", e.getMessage());
            return Map.of("answer", "AI 분석 중 오류가 발생했습니다.");
        }
    }

    // 시뮬레이션 챗 스트리밍 — 단계별 SSE 이벤트 emit 후 Python 스트리밍 프록시
    public reactor.core.publisher.Flux<String> simulationChatStream(
            String intNo, List<Map<String, Object>> simulation,
            List<Map<String, Object>> routeTraffic, List<String> bottleneckIntNos,
            String question, String userEmail) {
        return reactor.core.publisher.Flux.create(sink -> {
            try {
                // Step 1: 신호계획 조회
                sink.next(stepEvent("신호계획 조회 중", bottleneckIntNos != null && !bottleneckIntNos.isEmpty()
                        ? "교차로 " + String.join(", ", bottleneckIntNos) : intNo != null ? intNo : ""));

                ObjectNode body = objectMapper.createObjectNode();
                body.put("question", question);

                if (bottleneckIntNos != null && !bottleneckIntNos.isEmpty()) {
                    List<Map<String, Object>> contexts = new java.util.ArrayList<>();
                    for (String id : bottleneckIntNos) {
                        if (id != null && !id.isBlank()) {
                            Map<String, Object> ctx = signalService.getSimulationContext(id);
                            if (ctx != null && !ctx.isEmpty()) contexts.add(ctx);
                        }
                    }
                    if (!contexts.isEmpty()) body.set("contexts", objectMapper.valueToTree(contexts));
                } else if (intNo != null && !intNo.isBlank()) {
                    Map<String, Object> ctx = signalService.getSimulationContext(intNo);
                    body.set("context", objectMapper.valueToTree(ctx));
                }

                if (routeTraffic != null && !routeTraffic.isEmpty())
                    body.set("routeTraffic", objectMapper.valueToTree(routeTraffic));
                if (userEmail != null && !userEmail.isBlank())
                    body.put("userEmail", userEmail);

                // Step 2: 신호 데이터 적재 완료
                sink.next(stepEvent("신호 데이터 적재", ""));

                // Step 3: AI 추론 시작 (Python 스트리밍 프록시)
                sink.next(stepEvent("AI 추론 중", ""));

                webClient.post()
                        .uri(agentUrl + "/api/agent/simulation-chat/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(body)
                        .retrieve()
                        .bodyToFlux(String.class)
                        .subscribe(sink::next, sink::error, sink::complete);

            } catch (Exception e) {
                log.error("시뮬레이션 스트리밍 실패: {}", e.getMessage());
                sink.next("data: {\"type\":\"error\",\"content\":\"" + e.getMessage() + "\"}\n\n");
                sink.complete();
            }
        });
    }

    private String stepEvent(String label, String detail) {
        try {
            ObjectNode node = objectMapper.createObjectNode();
            node.put("type", "step");
            node.put("label", label);
            if (detail != null && !detail.isBlank()) node.put("detail", detail);
            return "data: " + objectMapper.writeValueAsString(node) + "\n\n";
        } catch (Exception e) {
            return "data: {\"type\":\"step\",\"label\":\"" + label + "\"}\n\n";
        }
    }

    // 병목 이메일 — Python은 리포트 텍스트만 생성, Spring이 직접 발송
    public String bottleneckEmail(String districtName, String userEmail) {
        if (userEmail == null || userEmail.isBlank()) {
            return "수신자 이메일이 없습니다. 로그인 후 다시 시도해주세요.";
        }
        try {
            // 1. Python 에이전트에서 리포트 텍스트만 받아옴
            ObjectNode body = objectMapper.createObjectNode();
            body.put("district", districtName);

            String response = webClient.post()
                    .uri(agentUrl + "/api/agent/district-report")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode root = objectMapper.readTree(response);
            String report = root.path("report").asText("");

            // 2. Spring JavaMailSender로 직접 발송
            emailService.send(
                userEmail,
                "[병목 경보] 서울 " + districtName,
                report
            );
            return report + "\n\n[발송 완료] " + userEmail;
        } catch (Exception e) {
            log.error("병목 메일 전송 실패: {}", e.getMessage());
            return "메일 전송 중 오류가 발생했습니다.";
        }
    }

    // 구 단위 리포트 — 메인 대시보드
    public String districtReport(String districtName) {
        try {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("district", districtName);

            String response = webClient.post()
                    .uri(agentUrl + "/api/agent/district-report")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode root = objectMapper.readTree(response);
            return root.path("report").asText("리포트 생성 실패");

        } catch (Exception e) {
            log.error("구 리포트 생성 실패: {}", e.getMessage());
            return "리포트 생성 중 오류가 발생했습니다.";
        }
    }
}
