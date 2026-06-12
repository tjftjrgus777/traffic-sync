package com.example.demo.service;

import com.example.demo.entity.ComplaintEntity;
import com.example.demo.entity.ComplaintPhotoEntity;
import com.example.demo.repository.ComplaintPhotoRepository;
import com.example.demo.repository.ComplaintRepository;
import com.example.demo.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ComplaintService {

    private final ComplaintRepository complaintRepo;
    private final ComplaintPhotoRepository photoRepo;
    private final UserRepository userRepo;
    private final EmailService emailService;

    @Value("${complaint.upload.dir:uploads/complaints}")
    private String uploadDir;

    // 서버 시작 시 guName 없는 기존 레코드 자동 삭제
    @PostConstruct
    public void cleanLegacyData() {
        int deleted = complaintRepo.deleteByGuNameIsNull();
        if (deleted > 0) log.info("[민원] 구 정보 없는 기존 레코드 {}건 삭제", deleted);
    }

    // 전체 조회 (민원 관리 페이지용)
    public List<Map<String, Object>> getAll() {
        return complaintRepo.findAllByOrderByCreatedAtDesc()
            .stream().map(this::toMap).collect(Collectors.toList());
    }

    // 구별 조회 (지도 폴링용)
    public List<Map<String, Object>> getByGu(String guName) {
        List<ComplaintEntity> list = (guName == null || guName.isBlank())
            ? complaintRepo.findAllByOrderByCreatedAtDesc()
            : complaintRepo.findByGuNameOrderByCreatedAtDesc(guName);
        return list.stream().map(this::toMap).collect(Collectors.toList());
    }

    public Map<String, Object> create(
            String userId, String userName,
            String title, String category, String content,
            Double lat, Double lng, String address,
            String department, String aiReason,
            List<MultipartFile> photos) {

        ComplaintEntity c = new ComplaintEntity();
        c.setUserId(userId);
        c.setUserName(userName);
        c.setTitle(title);
        c.setCategory(category);
        c.setContent(content);
        c.setLat(lat);
        c.setLng(lng);
        c.setAddress(address);
        c.setGuName(extractGuName(address));
        c.setDepartment(department);
        c.setAiReason(aiReason);
        c.setStatus("접수");
        c.setCreatedAt(LocalDateTime.now());
        complaintRepo.save(c);

        // 사진 BLOB 저장
        List<String> photoUrls = new ArrayList<>();
        if (photos != null) {
            for (MultipartFile photo : photos) {
                if (photo.isEmpty()) continue;
                try {
                    ComplaintPhotoEntity p = new ComplaintPhotoEntity();
                    p.setComplaintId(c.getId());
                    p.setData(photo.getBytes());
                    p.setMimeType(photo.getContentType() != null ? photo.getContentType() : "image/jpeg");
                    photoRepo.save(p);
                    photoUrls.add("/api/complaints/photos/" + p.getId());
                } catch (IOException e) {
                    log.warn("[민원] 사진 BLOB 저장 실패: {}", e.getMessage());
                }
            }
        }
        c.setPhotoUrls(photoUrls.isEmpty() ? null : String.join(",", photoUrls));
        complaintRepo.save(c);
        return Map.of("success", true, "id", c.getId(),
                      "guName", c.getGuName() != null ? c.getGuName() : "",
                      "message", "민원이 접수되었습니다.");
    }

    public Map<String, Object> updateStatus(Long id, String status) {
        return complaintRepo.findById(id).map(c -> {
            c.setStatus(status);
            complaintRepo.save(c);
            sendStatusEmail(c, status);
            return Map.<String, Object>of("success", true);
        }).orElse(Map.of("success", false, "message", "민원을 찾을 수 없습니다."));
    }

    private void sendStatusEmail(ComplaintEntity c, String status) {
        if (c.getUserId() == null) return;
        userRepo.findById(c.getUserId()).ifPresent(user -> {
            String email = user.getEmail();
            if (email == null || email.isBlank()) return;
            try {
                String subject = "[Syncro] '" + c.getTitle() + "' 처리 현황 안내";
                String body = String.format(
                    "%s 님, 신청하신 민원의 처리 현황을 알려드립니다.\n\n" +
                    "■ 민원 제목: %s\n" +
                    "■ 민원 분류: %s\n" +
                    "■ 접수 위치: %s\n" +
                    "■ 현재 상태: %s\n\n" +
                    "%s\n\n" +
                    "Syncro 서울시 교통 관제 시스템",
                    user.getName(),
                    c.getTitle(),
                    c.getCategory() != null ? c.getCategory() : "—",
                    c.getAddress() != null ? c.getAddress() : "—",
                    status,
                    "처리중".equals(status)
                        ? "담당 부서에서 민원을 검토 중입니다. 처리 완료 시 다시 안내드리겠습니다."
                        : "완료".equals(status)
                        ? "민원 처리가 완료되었습니다. 이용해 주셔서 감사합니다."
                        : ""
                );
                emailService.send(email, subject, body);
            } catch (Exception e) {
                log.warn("[민원 이메일] 발송 실패 userId={}: {}", c.getUserId(), e.getMessage());
            }
        });
    }

    // ── 내부 유틸 ────────────────────────────────────────────────────────────────

    // "서울 서초구 서초동 370-6" → "서초구"
    private static final Pattern GU_PATTERN = Pattern.compile("([가-힣]+구)");

    private String extractGuName(String address) {
        if (address == null || address.isBlank()) return null;
        Matcher m = GU_PATTERN.matcher(address);
        return m.find() ? m.group(1) : null;
    }

    public Optional<ComplaintPhotoEntity> getPhoto(Long photoId) {
        return photoRepo.findById(photoId);
    }

    public Map<String, Object> delete(Long id) {
        if (!complaintRepo.existsById(id))
            return Map.of("success", false, "message", "민원을 찾을 수 없습니다.");
        photoRepo.findByComplaintId(id).forEach(p -> photoRepo.delete(p));
        complaintRepo.deleteById(id);
        return Map.of("success", true);
    }

    private Map<String, Object> toMap(ComplaintEntity c) {
        List<String> photoList = (c.getPhotoUrls() == null || c.getPhotoUrls().isBlank())
            ? List.of() : Arrays.asList(c.getPhotoUrls().split(","));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",        c.getId());
        m.put("userId",    c.getUserId());
        m.put("userName",  c.getUserName());
        m.put("title",     c.getTitle());
        m.put("category",  c.getCategory());
        m.put("content",   c.getContent());
        m.put("lat",       c.getLat());
        m.put("lng",       c.getLng());
        m.put("address",   c.getAddress());
        m.put("guName",    c.getGuName());
        m.put("photoUrls",  photoList);
        m.put("department", c.getDepartment());
        m.put("aiReason",   c.getAiReason());
        m.put("status",     c.getStatus());
        m.put("createdAt", c.getCreatedAt() != null ? c.getCreatedAt().toString() : null);
        return m;
    }
}
