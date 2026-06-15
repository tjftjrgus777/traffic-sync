/**
 * AI 플로팅 버튼 (우하단 고정)
 * - 세션이 없으면 챗봇 아이콘 표시
 * - 세션이 열려 있으면 ✕ 표시
 */

const CHATBOT_ICON = "/icons/chatbot.webp";

export default function AIFloatingButton({
  active,
  minimized,
  onClick,
}) {
  const isOpen = active && !minimized;

  return (
    <button
      onClick={onClick}
      title={isOpen ? "AI 챗봇 닫기" : "AI 교통 어시스턴트 열기"}
      style={{
        position: "fixed",
        bottom: 28,
        right: 28,
        zIndex: 9998,

        width: 54,
        height: 54,
        borderRadius: "50%",

        background: isOpen
          ? "linear-gradient(135deg, rgba(30,41,59,0.98), rgba(59,130,246,0.94))"
          : "linear-gradient(135deg, rgba(30,41,59,0.96), rgba(59,130,246,0.9))",

        border: `2px solid ${
          isOpen
            ? "rgba(147,197,253,0.72)"
            : "rgba(147,197,253,0.55)"
        }`,

        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",

        cursor: "pointer",

        display: "flex",
        alignItems: "center",
        justifyContent: "center",

        boxShadow:
          isOpen
            ? "0 8px 24px rgba(0,0,0,0.62), 0 0 20px rgba(96,165,250,0.34)"
            : "0 4px 18px rgba(0,0,0,0.62), 0 0 16px rgba(96,165,250,0.28)",

        transition: "all .2s",
        padding: 0,
        overflow: "hidden",
      }}
    >
      {isOpen ? (
        <span
          style={{
            fontSize: 16,
            color: "rgba(226,232,240,0.86)",
            lineHeight: 1,
          }}
        >
          ✕
        </span>
      ) : (
        <img
          src={CHATBOT_ICON}
          alt="AI 상담사"
          style={{
            width: 42,
            height: 42,
            objectFit: "contain",
            display: "block",
            transform: "translateY(1px)",
          }}
        />
      )}
    </button>
  );
}
