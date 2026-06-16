package com.example.demo.controller;

import com.example.demo.model.ForecastResult;
import com.example.demo.service.ForecastService;

import com.example.demo.entity.TrafficStationEntity; // 지점 엔티티 경로 확인 필요!
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List; // List를 쓰기 위해 필요

@RestController
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
@RequestMapping("/api") // 1. 공통 경로 확인
public class ForecastController {

    private final ForecastService forecastService;

    // 2. 이 부분의 경로를 리액트 fetch 주소와 일치 (리액트가 /api/forecast/station/10 으로 보냄)
    @GetMapping("/forecast/station/{stationId}")
    public ResponseEntity<ForecastResult> getForecast(@PathVariable String stationId) {
        ForecastResult result = forecastService.getForecast(stationId);
        if (result == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(result);
    }

    // 3. 지점 목록 가져오는 API 주소도 확인 (/api/stations)
    @GetMapping("/stations")
    public ResponseEntity<List<TrafficStationEntity>> getStations() {
        return ResponseEntity.ok(forecastService.findAllStations());
    }
}