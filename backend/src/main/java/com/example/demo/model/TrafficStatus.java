package com.example.demo.model;

import com.example.demo.model.context.WeatherSnapshot;
import lombok.Data;

import java.util.Map;

// WebSocket과 REST API로 내려주는 교차로별 현재 통합 상태.
// V2X 신호 원본에 TOPIS 속도, 도로위험도, 날씨, 계산 지표를 함께 담아
// 프론트 대시보드와 챗봇이 같은 데이터를 보도록 맞춘다.
@Data
public class TrafficStatus {
    private String crsrdId;
    private String crsrdNm;
    private double lat;
    private double lon;
    private String guName;

    // key: "nt","et","st","wt","ne","se","sw","nw" b
    private Map<String, SignalDirection> signals;

    // V2X 원본 수집 시각. 예: "20260506113801"
    private String totDt;

    // Spring Boot가 데이터를 처리한 시각(epoch ms).
    private long serverTimeMs;

    // 신호 잔여시간에서 계산한 평균 대기시간(초). 외부 API 값이 아니라 V2X 신호 기반 계산값이다.
    private Integer avgWaitSec;

    // TOPIS 속도 기준 혼잡 상태. 속도 데이터가 없으면 신호 잔여시간 기준으로 보조 계산한다.
    private String congestion;

    // TOPIS 도로 속도 API에서 가져온 실제 구간 속도/통행시간.
    // speedKph는 방향별 진입 속도가 있으면 그 중 최저(가장 막힌 진입)를 대표값으로 사용한다.
    private Double speedKph;
    private Integer travelTimeSec;
    private boolean speedStale;

    // 방향별 진입 속도(km/h). key는 신호와 동일한 V2X 방향 코드(nt/et/st/wt/ne/se/sw/nw).
    // 교차로에는 여러 진입 도로가 있으므로 단일 speedKph로 표현할 수 없는 부분을 보완한다.
    private Map<String, Double> speedKphByDirection;

    // 도로위험도 API에서 가져온 실제 위험 지수/등급.
    private Double riskIndex;
    private String riskGrade;
    private Double riskScore;
    private boolean riskStale;

    // 현재 수집된 날씨 스냅샷. 아직 수집 전이면 null일 수 있다.
    private WeatherSnapshot weather;
}
