package com.example.demo.controller;

import com.example.demo.entity.UserEntity;
import com.example.demo.service.EmailService;
import com.example.demo.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final EmailService emailService;

    // 로그인
    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> body) {
        String userId   = body.get("userId");
        String password = body.get("password");
        if (userId == null || password == null) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(userService.login(userId, password));
    }

    // 회원가입
    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@RequestBody UserEntity req) {
        return ResponseEntity.ok(userService.register(req));
    }

    // 아이디 찾기
    @GetMapping("/find-id")
    public ResponseEntity<Map<String, Object>> findId(
            @RequestParam String name,
            @RequestParam String phone) {
        return ResponseEntity.ok(userService.findId(name, phone));
    }

    // 비밀번호 찾기 (임시 비밀번호 메일 발송)
    @PostMapping("/find-pw")
    public ResponseEntity<Map<String, Object>> findPw(@RequestBody Map<String, String> body) {
        String userId = body.get("userId");
        String email  = body.get("email");
        if (userId == null || email == null) return ResponseEntity.badRequest().build();

        Map<String, Object> result = userService.findPw(userId, email);
        if (!(Boolean) result.get("success")) return ResponseEntity.ok(result);

        // Spring JavaMailSender로 직접 발송
        try {
            String tempPw = (String) result.get("tempPw");
            String name   = (String) result.get("name");
            emailService.send(
                email,
                "[Syncro] 임시 비밀번호 안내",
                name + "님, 임시 비밀번호는 " + tempPw + " 입니다.\n로그인 후 반드시 비밀번호를 변경해주세요."
            );
        } catch (Exception ignored) {}

        return ResponseEntity.ok(Map.of("success", true, "message", "임시 비밀번호가 이메일로 발송되었습니다."));
    }

    // 관리자: 유저 목록
    @GetMapping("/admin/users")
    public ResponseEntity<List<UserEntity>> getUsers() {
        return ResponseEntity.ok(userService.getAllUsers());
    }

    // 관리자: 승인
    @PostMapping("/admin/approve/{userId}")
    public ResponseEntity<Map<String, Object>> approve(@PathVariable String userId) {
        return ResponseEntity.ok(userService.approve(userId));
    }

    // 관리자: 거절
    @PostMapping("/admin/reject/{userId}")
    public ResponseEntity<Map<String, Object>> reject(@PathVariable String userId) {
        return ResponseEntity.ok(userService.reject(userId));
    }

    // 알림 수신 토글 (마이페이지)
    @PostMapping("/alert")
    public ResponseEntity<Map<String, Object>> toggleAlert(@RequestBody Map<String, Object> body) {
        String userId = (String) body.get("userId");
        Integer alertEmail = (Integer) body.get("alertEmail");
        if (userId == null || alertEmail == null) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(userService.updateAlert(userId, alertEmail));
    }

    // 비밀번호 변경 (마이페이지)
    @PostMapping("/change-pw")
    public ResponseEntity<Map<String, Object>> changePw(@RequestBody Map<String, String> body) {
        String userId  = body.get("userId");
        String curPw   = body.get("currentPassword");
        String newPw   = body.get("newPassword");
        if (userId == null || curPw == null || newPw == null) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(userService.changePassword(userId, curPw, newPw));
    }

    // 메일 알림 수신 이메일 목록 (병목 알림 발송용)
    @GetMapping("/alert-emails")
    public ResponseEntity<List<String>> getAlertEmails() {
        return ResponseEntity.ok(userService.getAlertEmails());
    }
}
