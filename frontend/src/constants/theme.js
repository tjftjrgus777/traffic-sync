/**
 * 공통 디자인 토큰 (다크 테마)
 * ------------------------------------------------------------------
 * 인라인 스타일에서 색상/폰트를 일관되게 쓰기 위한 상수 맵.
 * MainDashboard, CctvDashboard 등 동일 팔레트를 쓰는 화면이 공유한다.
 * (Newsdashboard, LoginPage, MyPage는 키 구성이 달라 각자 로컬 정의를 유지)
 */
export const V = {
  // 배경 / 구분선
  bg0: "var(--syncro-bg0)", bg1: "var(--syncro-bg1)", line: "var(--syncro-line)",
  // 텍스트 명도 단계 (0=밝음 → 3=어두움)
  ink0: "var(--syncro-ink0)", ink1: "var(--syncro-ink1)", ink2: "var(--syncro-ink2)", ink3: "var(--syncro-ink3)",
  // 상태 색상
  grn: "#2ee07a", yel: "#facc15", red: "#ff5566", org: "#ffaa33", blu: "#4ea6ff",
  // 폰트
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR','Malgun Gothic',system-ui,sans-serif",
};
