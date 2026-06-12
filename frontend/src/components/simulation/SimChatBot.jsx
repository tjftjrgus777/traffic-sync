// AI 신호 분석 챗봇 컴포넌트
import { useState, useEffect, useCallback, Fragment } from "react";

// 시뮬레이션 답변 포맷: 현시N 앞 줄바꿈, 교차로 전환 시 빈 줄 삽입
function formatSimAnswer(text) {
  return text
    .replace(/\s+(현시\d+)/g, '\n  $1')          // 현시N 앞에 줄바꿈 + 들여쓰기
    .replace(/(→\s*\d+s)\s+([가-힣])/g, '$1\n\n$2') // → Ns 뒤 교차로명 앞 빈 줄
    .trim();
}

// **볼드** 마크다운을 <strong>으로 변환해 렌더링
function renderBold(text) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: "#7dd3fc", fontWeight: 700 }}>{part}</strong>
      : <Fragment key={i}>{part}</Fragment>
  );
}

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const CHATBOT_ICON = "/icons/chatbot.webp";

const SIM_PRESETS = [
  { label: "현재 현시", q: "지금 몇 번 현시가 켜져 있어?" },
  { label: "신호 최적화", q: "이 교차로 신호 조정 권고해줘" },
  { label: "사이클 분석", q: "현시 구성이랑 사이클 시간 설명해줘" },
];

function resolveSegments(segments) {
  if (!segments?.length) return [];
  return segments
    .map(seg => {
      const speed = seg.selectedTraffic ?? seg.up;
      if (!speed?.speedKph) return null;
      return { fromIntNo: seg.fromIntNo, toIntNo: seg.toIntNo, axisName: seg.axisName, speedKph: speed.speedKph, congestion: speed.congestion };
    })
    .filter(Boolean);
}

function getUserEmail() {
  return JSON.parse(localStorage.getItem("ts_user") || "{}").email || null;
}

export default function SimChatBot({ intNo, intNm, simulation, routeTraffic, autoTrigger }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "ai", text: "교차로를 클릭하면 신호계획 분석을 도와드립니다.\n현재 현시, 최적화 방안 등 자유롭게 질문하세요." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailState, setEmailState] = useState({});  // idx → 'sending'|'sent'|'error'

  const buildBody = (question, intNoVal, simVal, rt) => {
    const body = { question, intNo: intNoVal ?? null, userEmail: getUserEmail() };
    if (simVal?.length > 0) body.simulation = simVal;
    const resolved = resolveSegments(rt?.segments);
    if (resolved.length > 0) body.routeTraffic = resolved;
    return body;
  };

  // autoTrigger: 외부(경로 최적화 등)에서 자동으로 AI 질문을 유발할 때 사용
  useEffect(() => {
    if (!autoTrigger?.question) return;
    setIsOpen(true);
    const { question, intNo: aIntNo, simulation: aSim, routeTraffic: aRt } = autoTrigger;
    setMessages(prev => [...prev, { role: "user", text: question }]);
    setLoading(true);

    fetch(`${API_BASE}/api/simulation-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(question, aIntNo, aSim, aRt)),
    })
      .then(r => r.json())
      .then(data => setMessages(prev => [...prev, { role: "ai", text: data.answer }]))
      .catch(err => setMessages(prev => [...prev, { role: "ai", text: `오류: ${err.message}` }]))
      .finally(() => setLoading(false));
  }, [autoTrigger]);

  const send = useCallback(async (preset) => {
    const q = (preset ?? input).trim();
    if (!q || loading) return;
    setMessages(prev => [...prev, { role: "user", text: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/simulation-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(q, intNo, simulation, routeTraffic)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(prev => [...prev, { role: "ai", text: data.answer }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "ai", text: `오류: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, intNo, simulation, routeTraffic]);

  const btnBase = { borderRadius: 2, border: "none", cursor: loading ? "default" : "pointer", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column-reverse", alignItems: "flex-end", gap: 8 }}>
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          width: 54, height: 54, borderRadius: "50%",
          background: isOpen
            ? "linear-gradient(135deg, rgba(96,165,250,0.95), rgba(168,85,247,0.95))"
            : "linear-gradient(135deg, rgba(30,41,59,0.96), rgba(59,130,246,0.9))",
          border: `2px solid ${isOpen ? "rgba(255,255,255,0.38)" : "rgba(147,197,253,0.55)"}`,
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 18px rgba(0,0,0,0.62), 0 0 16px rgba(96,165,250,0.28)",
          transition: "all .2s", padding: 0,
        }}
        title={isOpen ? "AI 챗봇 닫기" : "AI 신호 분석 열기"}
      >
        {isOpen
          ? <span style={{ fontSize: 16, color: "rgba(255,255,255,0.55)" }}>✕</span>
          : <img src={CHATBOT_ICON} alt="AI 상담사" style={{ width: 42, height: 42, objectFit: "contain", display: "block", transform: "translateY(1px)" }} />
        }
      </button>

      {isOpen && (
        <div style={{
          width: 340, maxHeight: "calc(100vh - 310px)", minHeight: 360,
          background: "rgba(18,16,10,0.94)", border: "1px solid rgba(42,36,24,0.8)",
          borderRadius: 8, padding: "16px 18px", backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)", display: "flex", flexDirection: "column",
          gap: 10, boxShadow: "0 14px 38px rgba(0,0,0,0.45)", overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#4ea6ff" }}>AI 신호 분석</span>
            {intNm && <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>● {intNm}</span>}
          </div>

          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {SIM_PRESETS.map(({ label, q }) => (
              <button key={label} onClick={() => send(q)} disabled={loading} style={{ ...btnBase, padding: "5px 12px", fontSize: 12, border: "1px solid #2a3a5a", background: loading ? "transparent" : "rgba(78,166,255,0.1)", color: loading ? "#3a3a3a" : "#4ea6ff" }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
                <div style={{ maxWidth: "92%", padding: "9px 13px", borderRadius: 2, background: m.role === "user" ? "rgba(78,166,255,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${m.role === "user" ? "#2a3a5a" : "#1a1a1a"}`, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-line", color: "#e7ecf5" }}>
                  {m.role === "ai" && <div style={{ fontSize: 11, color: "#4ea6ff", marginBottom: 3 }}>Qwen3 분석</div>}
                  {m.role === "ai" ? renderBold(formatSimAnswer(m.text)) : m.text}
                </div>
                {/* 이메일 버튼 — AI 메시지이고 초기 안내 메시지가 아닐 때만 */}
                {m.role === "ai" && i > 0 && getUserEmail() && (
                  emailState[i] === "sent" ? (
                    <span style={{ fontSize: 11, color: "rgba(100,200,120,0.8)", paddingLeft: 2 }}>✓ 상세 리포트 이메일 발송 완료</span>
                  ) : emailState[i] === "error" ? (
                    <span style={{ fontSize: 11, color: "rgba(255,100,100,0.8)", paddingLeft: 2 }}>발송 실패 — 다시 시도</span>
                  ) : (
                    <button
                      disabled={emailState[i] === "sending" || loading}
                      onClick={async () => {
                        const userEmail = getUserEmail();
                        if (!userEmail) return;
                        setEmailState(prev => ({ ...prev, [i]: "sending" }));
                        try {
                          // 상세 Webster 리포트를 별도 요청
                          const detailRes = await fetch(`${API_BASE}/api/simulation-chat`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(buildBody(
                              "위 신호 조정 결과를 Webster 공식 계산 과정(실측 속도, Y값, Co 계산식, 현시별 배분 이유)을 포함한 상세 이메일 리포트로 작성해줘.",
                              intNo, simulation, routeTraffic
                            )),
                          });
                          const detailData = await detailRes.json();
                          const detailText = detailData.answer || m.text;
                          const emailRes = await fetch(`${API_BASE}/api/email/send`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              to: userEmail,
                              subject: `[Syncro] ${intNm || "교차로"} 분석결과를 알려드립니다`,
                              body: detailText,
                            }),
                          });
                          setEmailState(prev => ({ ...prev, [i]: emailRes.ok ? "sent" : "error" }));
                        } catch {
                          setEmailState(prev => ({ ...prev, [i]: "error" }));
                        }
                      }}
                      style={{
                        ...btnBase,
                        padding: "3px 10px", fontSize: 11,
                        border: "1px solid #2a3a5a",
                        background: emailState[i] === "sending" ? "transparent" : "rgba(78,166,255,0.08)",
                        color: emailState[i] === "sending" ? "#3a3a3a" : "#4ea6ff",
                        cursor: (emailState[i] === "sending" || loading) ? "default" : "pointer",
                      }}
                    >
                      {emailState[i] === "sending" ? "리포트 생성 중..." : "📧 상세 리포트 이메일"}
                    </button>
                  )
                )}
              </div>
            ))}
            {loading && (
              <div style={{ padding: "9px 13px", borderRadius: 2, background: "rgba(255,255,255,0.04)", border: "1px solid #1a1a1a", fontSize: 12, color: "#4ea6ff" }}>
                신호계획 분석 중...
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !loading && send()}
              placeholder={intNo ? "신호 최적화, 현시 구성 등 질문..." : "교차로를 먼저 선택하세요"}
              disabled={loading}
              style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid #1a1a1a", borderRadius: 2, padding: "9px 13px", color: "#e7ecf5", fontSize: 13, outline: "none", fontFamily: "inherit", opacity: loading ? 0.6 : 1 }}
            />
            <button onClick={() => send()} disabled={loading} style={{ ...btnBase, padding: "9px 18px", background: loading ? "#1a1a1a" : "#4ea6ff", color: loading ? "#3a3a3a" : "#000", fontSize: 14, fontWeight: 700 }}>
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
