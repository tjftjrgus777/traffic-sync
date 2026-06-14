package com.example.demo.controller;

import com.example.demo.entity.TrafficNewsEntity;
import com.example.demo.repository.TrafficNewsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class NewsController {

    private final TrafficNewsRepository newsRepository;

    @GetMapping("/news/latest")
    public ResponseEntity<?> getLatestNews(
            @RequestParam(defaultValue = "10000") int limit,
            @RequestParam(required = false) String category
    ) {
        List<TrafficNewsEntity> news;
        if (category != null && !category.isBlank()) {
            news = newsRepository.findLatestByCategory(category, limit);
        } else {
            news = newsRepository.findLatest(limit);
        }
        return ResponseEntity.ok(Map.of("count", news.size(), "news", news));
    }
}
