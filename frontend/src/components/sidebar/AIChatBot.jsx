import { useState, useCallback, useRef, useEffect } from "react";
import { useClapDetection } from "../../hooks/useClapDetection";
import { ThinkingBlock, InlineSteps } from "./ChatSteps";

const PYTHON_BASE    = import.meta.env.VITE_PYTHON_URL    || "http://localhost:8001";
const API_BASE       = (import.meta.env.VITE_API_URL       || "http://localhost:8080").replace(/\/+$/, "");
const GOOGLE_TTS_KEY = import.meta.env.VITE_GOOGLE_TTS_KEY || "";

const INITIAL_MSG = [
  {
    role: "ai",
    text: "안녕하세요! 서울 교통 AI 어시스턴트입니다.\n마이크 버튼을 눌러 음성으로 질문하거나 직접 입력하세요.\n예) '잠실역 교차로 어때?' / '강남구 막히는 곳은?'",
    steps: [],
  },
];

const PRESETS = [
  { label: "병목 TOP3",   q: "지금 가장 막히는 교차로 3곳 알려줘" },
  { label: "신호 최적화", q: "현재 가장 정체가 심한 교차로의 신호 조정 방법을 알려줘" },
  { label: "날씨 현황",   q: "현재 날씨 상황이 교통에 어떤 영향을 미치고 있어?" },
  { label: "주변 분석",   q: "주변 교차로 분석해줘", multi: true },
];

// 마크다운 기호 제거 (TTS 읽기 전처리 — 링크 텍스트도 풀어줌)
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

const MSG_STORAGE_KEY       = 'ts_chatbot_messages';
const COLLAPSED_STORAGE_KEY = 'ts_chatbot_collapsed';
const LIVE_STORAGE_KEY      = 'ts_chatbot_live';

export default function AIChatBot({ selected, onClose, isMuted = false }) {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(MSG_STORAGE_KEY);
      return saved ? JSON.parse(saved) : INITIAL_MSG;
    } catch { return INITIAL_MSG; }
  });
  const [input,          setInput]          = useState("");
  const [loading,        setLoading]        = useState(false);
  const [emailSent,      setEmailSent]      = useState({});  // idx → 'sending'|'sent'|'error'
  // 스트리밍 중단 복원: 마지막으로 저장된 liveSteps부터 시작
  const [liveSteps, setLiveSteps] = useState(() => {
    try {
      const saved = sessionStorage.getItem(LIVE_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  // 접힘 상태 복원: 닫았다 열어도 펼쳐진 추론은 그대로 유지
  const [collapsedSteps, setCollapsedSteps] = useState(() => {
    try {
      const saved = sessionStorage.getItem(COLLAPSED_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [listening,      setListening]      = useState(false);
  const [speaking,       setSpeaking]       = useState(false);

  const bottomRef       = useRef(null);
  const inputRef        = useRef(null);
  const audioRef        = useRef(null);
  const actionAudioRef  = useRef(null);
  const recognitionRef  = useRef(null);
  const abortCtrlRef    = useRef(null);  // 진행 중인 SSE fetch abort용
  const userStoppedRef  = useRef(false); // 사용자가 직접 정지 버튼 눌렀는지

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveSteps]);

  const isMutedRef = useRef(isMuted)
  useEffect(() => {
    isMutedRef.current = isMuted
    if (isMuted) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setSpeaking(false); window.__chatbotSpeaking = false; }
      if (actionAudioRef.current) { actionAudioRef.current.pause(); actionAudioRef.current = null; }
    }
  }, [isMuted]);

  // 세션 유지 — 닫았다 열어도 메시지·추론·접힘 상태 모두 보존
  useEffect(() => {
    try { sessionStorage.setItem(MSG_STORAGE_KEY, JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    try {
      if (liveSteps.length > 0) sessionStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(liveSteps));
      else sessionStorage.removeItem(LIVE_STORAGE_KEY);
    } catch {}
  }, [liveSteps]);

  useEffect(() => {
    try { sessionStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsedSteps)); } catch {}
  }, [collapsedSteps]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // ── TTS: Google Cloud Text-to-Speech ──────────────────────────────
  // 공통 TTS 요청 함수
  async function _tts(text, rate = 1.05) {
    if (!GOOGLE_TTS_KEY || !text) return null;
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: stripMarkdown(text).slice(0, 4500) },
          voice: { languageCode: "ko-KR", name: "ko-KR-Neural2-C", ssmlGender: "MALE" },
          audioConfig: { audioEncoding: "MP3", speakingRate: rate },
        }),
      }
    );
    const data = await res.json();
    return data.audioContent || null;
  }

  // 전체 답변 TTS (자동재생)
  const speakText = useCallback(async (text) => {
    if (!GOOGLE_TTS_KEY || !text || isMutedRef.current) return;
    stopSpeaking();
    setSpeaking(true);
    window.__chatbotSpeaking = true;
    try {
      const content = await _tts(text, 1.05);
      if (content) {
        const audio = new Audio(`data:audio/mp3;base64,${content}`);
        audioRef.current = audio;
        audio.onended = () => { setSpeaking(false); window.__chatbotSpeaking = false; };
        audio.play();
      } else { setSpeaking(false); window.__chatbotSpeaking = false; }
    } catch { setSpeaking(false); window.__chatbotSpeaking = false; }
  }, []);

  // 도구 호출 알림 TTS — 이전 도구 알림 즉시 교체 (큐 없음)
  const speakAction = useCallback(async (label) => {
    if (!GOOGLE_TTS_KEY || !label || isMutedRef.current) return;
    try {
      const content = await _tts(label, 1.4);
      if (content) {
        if (actionAudioRef.current) {
          actionAudioRef.current.pause();
          actionAudioRef.current = null;
        }
        const audio = new Audio(`data:audio/mp3;base64,${content}`);
        actionAudioRef.current = audio;
        audio.play();
      }
    } catch { /* 무시 */ }
  }, []);

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
    window.__chatbotSpeaking = false;
  }

  // ── STT: Web Speech API ───────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("음성 인식은 Chrome 브라우저에서만 지원됩니다.");
      return;
    }
    stopSpeaking();
    const rec = new SR();
    rec.lang            = "ko-KR";
    rec.interimResults  = false;
    rec.maxAlternatives = 1;

    rec.onstart  = () => setListening(true);
    rec.onend    = () => setListening(false);
    rec.onerror  = () => setListening(false);
    rec.onresult = (e) => {
      // 인식 결과를 입력창에 채우기만 함 (전송은 사용자가 직접)
      setInput(e.results[0][0].transcript);
    };

    recognitionRef.current = rec;
    rec.start();
  }, []);

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  const toggleMic = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening]);

  // ── 박수 감지 (startListening 정의 이후에 위치해야 함) ──────────────
  // 박수 2번 = TTS 중단만 (마이크 시작은 수동 버튼으로)
  useClapDetection({
    enabled: true,
    requiredClaps: 2,
    clapWindowMs: 700,
    onDoubleClap: useCallback(() => {
      const isPlaying = !!(audioRef.current && !audioRef.current.paused)
      if (isPlaying) stopSpeaking();
    }, []),
  });

  // 라우팅은 백엔드 LLM이 판단 (route_multi 이벤트로 응답)

  // ── 멀티에이전트 스트리밍 ──────────────────────────────────────
  async function _sendMulti(q, coordOverride = null) {
    // coordOverride: route_multi 이벤트에서 받은 { lat, lon, crsrdId, crsrdNm, preSteps }
    // selected가 null(교차로 미선택)일 때 백엔드가 찾아준 좌표 사용
    const lat      = coordOverride?.lat      ?? selected?.lat;
    const lon      = coordOverride?.lon      ?? selected?.lon;
    const crsrdId  = coordOverride?.crsrdId  ?? selected?.crsrdId;
    const crsrdNm  = coordOverride?.crsrdNm  ?? selected?.crsrdNm ?? "선택 교차로";
    const preSteps = coordOverride?.preSteps ?? [];

    setMessages(prev => [...prev, { role: "user", text: q, steps: [] }]);
    setInput("");
    setLoading(true);

    const multiMsgIdx = { current: -1 };
    setMessages(prev => {
      multiMsgIdx.current = prev.length;
      return [...prev, { role: "multi_group", centerName: crsrdNm, preSteps, workers: [], discussions: [], orchestrator: null, loadingWorkers: true, loadingDiscuss: false, currentRound: 0 }];
    });

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;
    userStoppedRef.current = false;

    try {
      const res = await fetch(`${PYTHON_BASE}/api/agent/multi-analyze/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat, lon, crsrdId, crsrdNm,
          userEmail: JSON.parse(localStorage.getItem("ts_user") || "{}").email || null,
        }),
        signal: abortCtrl.signal,
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.type === "done") {
            window.dispatchEvent(new CustomEvent("multiAnalyzeDone"));
            break;
          }
          if (data.type === "analyze_init") {
            window.dispatchEvent(new CustomEvent("multiAnalyzeInit", { detail: data }));
          }
          if (data.type === "error") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? { ...m, loadingWorkers: false, error: data.content } : m
            ));
          } else if (data.type === "worker_start") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? {
                ...m,
                workers: [...m.workers.filter(w => w.worker_id !== data.worker_id),
                  { worker_id: data.worker_id, direction: data.direction, crossroad_name: data.crossroad_name, loading: true, content: "" }],
              } : m
            ));
          } else if (data.type === "worker_done") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? {
                ...m,
                workers: m.workers.map(w =>
                  w.worker_id === data.worker_id ? { ...w, loading: false, content: data.content } : w
                ),
              } : m
            ));
          } else if (data.type === "discussion_start") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? { ...m, loadingWorkers: false, loadingDiscuss: true } : m
            ));
          } else if (data.type === "round_start") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? { ...m, currentRound: data.round, loadingDiscuss: true } : m
            ));
          } else if (data.type === "discuss_start") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? {
                ...m,
                discussions: [...(m.discussions || []),
                  { round: data.round, worker_id: data.worker_id, direction: data.direction, crossroad_name: data.crossroad_name, loading: true, content: "" }],
              } : m
            ));
          } else if (data.type === "discuss_done") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? {
                ...m,
                discussions: (m.discussions || []).map(d =>
                  d.round === data.round && d.worker_id === data.worker_id ? { ...d, loading: false, content: data.content } : d
                ),
              } : m
            ));
          } else if (data.type === "orchestrator_start") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? { ...m, loadingDiscuss: false, loadingOrch: true } : m
            ));
          } else if (data.type === "orchestrator_done") {
            setMessages(prev => prev.map((m, i) =>
              i === multiMsgIdx.current ? { ...m, loadingOrch: false, orchestrator: data.content } : m
            ));
            speakText(data.content);
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(prev => prev.map((m, i) =>
          i === multiMsgIdx.current ? { ...m, loadingWorkers: false, error: err.message } : m
        ));
      }
    } finally {
      abortCtrlRef.current = null;
      setLoading(false);
    }
  }

  // ── 채팅 전송 ─────────────────────────────────────────────────────
  const sendChat = useCallback(async (preset) => {
    const q = (preset ?? input).trim();
    if (!q || loading) return;
    await _send(q);
  }, [input, loading, selected]);

  async function _send(q, retryCount = 0) {
    const MAX_RETRY = 2;
    // 최초 시도일 때만 유저 메시지 추가 (재시도 시 중복 방지)
    if (retryCount === 0) {
      setMessages(prev => [...prev, { role: "user", text: q, steps: [] }]);
    }
    setInput("");
    setLoading(true);
    setLiveSteps([]);
    try { sessionStorage.removeItem(LIVE_STORAGE_KEY); } catch {}

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;
    userStoppedRef.current = false;  // 새 요청마다 초기화
    const abortTimer = setTimeout(() => abortCtrl.abort(), 120_000);

    try {
      const res = await fetch(`${PYTHON_BASE}/api/agent/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:  q,
          crsrdId:   selected?.crsrdId ?? null,
          crsrdNm:   selected?.crsrdNm ?? null,
          userEmail: JSON.parse(localStorage.getItem("ts_user") || "{}").email || null,
          lat:       selected?.lat ?? null,
          lon:       selected?.lon ?? null,
        }),
        signal: abortCtrl.signal,
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentSteps = [];
      let routedToMulti = false;
      let routeMultiData = null;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.type === "done") break outer;
          if (data.type === "route_multi") {
            // 백엔드 LLM이 멀티에이전트 분석으로 판단 → 재라우팅
            routedToMulti = true;
            routeMultiData = { ...data, preSteps: [...currentSteps] }; // 탐색 과정 스텝 포함
            reader.cancel().catch(() => {});
            break outer;
          }
          if (data.type === "answer") {
            setMessages(prev => [...prev, { role: "ai", text: data.content, steps: currentSteps }]);
            setLiveSteps([]);
            speakText(data.content);
          } else if (data.type === "error") {
            setMessages(prev => [...prev, { role: "ai", text: `오류: ${data.content}`, steps: [] }]);
            setLiveSteps([]);
          } else {
            // 도구 호출 시 음성 알림
            if (data.type === "action" && data.label) {
              speakAction(data.label);
            }
            currentSteps = [...currentSteps, data];
            setLiveSteps([...currentSteps]);
          }
        }
      }

      if (routedToMulti) {
        clearTimeout(abortTimer);
        abortCtrlRef.current = null;
        setLoading(false);
        setLiveSteps([]);
        // _send가 추가한 유저 메시지 제거 — _sendMulti가 다시 추가
        setMessages(prev => prev.slice(0, -1));
        await _sendMulti(q, routeMultiData);
        return;
      }
    } catch (err) {
      clearTimeout(abortTimer);
      // 사용자가 직접 정지 버튼 클릭 → 재시도 없이 종료
      if (err.name === "AbortError" && userStoppedRef.current) {
        setMessages(prev => [...prev, { role: "ai", text: "⏹ 생성이 중단되었습니다.", steps: [] }]);
        setLiveSteps([]);
        return;
      }
      if (err.name === "AbortError" && retryCount < MAX_RETRY) {
        // 90초 타임아웃 → 자동 재시도
        const attempt = retryCount + 1;
        setMessages(prev => [...prev, {
          role: "ai",
          text: `⏱ 응답 지연으로 재시도 중... (${attempt}/${MAX_RETRY})`,
          steps: [],
        }]);
        setLiveSteps([]);
        setLoading(false);
        await new Promise(r => setTimeout(r, 1000));
        await _send(q, attempt);
        return;
      }
      const msg = err.name === "AbortError"
        ? `⏱ ${MAX_RETRY}회 재시도했지만 응답이 없습니다. 잠시 후 다시 시도해주세요.`
        : `오류: ${err.message}`;
      setMessages(prev => [...prev, { role: "ai", text: msg, steps: [] }]);
      setLiveSteps([]);
    } finally {
      clearTimeout(abortTimer);
      abortCtrlRef.current = null;
      setLoading(false);
    }
  }

  const stopGeneration = () => {
    userStoppedRef.current = true;
    abortCtrlRef.current?.abort();
    // 백엔드에서 Ollama httpx 소켓 직접 차단
    fetch(`${PYTHON_BASE}/api/agent/stop`, { method: "POST" }).catch(() => {});
  };

  const toggleStep = (idx) => {
    setCollapsedSteps(prev => ({ ...prev, [idx]: !(prev[idx] ?? false) }));
  };

  return (
    <>
      <div style={{
        display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
        background: "rgba(11,11,11,0.95)",
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        fontFamily: "system-ui,-apple-system,sans-serif",
      }}>

        {/* 헤더 */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.72)" }}>
            AI 교통 어시스턴트
          </span>
          {selected && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>
              · {selected.crsrdNm}
            </span>
          )}
          {/* 재생 중 표시 */}
          {speaking && (
            <button onClick={stopSpeaking} title="음성 중지" style={{
              marginLeft: 4,
              background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.3)",
              borderRadius: 5, padding: "2px 8px",
              color: "rgba(255,120,120,0.9)", fontSize: 11, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
              fontFamily: "inherit",
            }}>
              <span style={{ animation: "chatDotBlink 1s ease infinite" }}>●</span> 재생 중 · 클릭해서 중지
            </button>
          )}
          <button
            onClick={() => {
              if (loading) return;
              try {
                sessionStorage.removeItem(MSG_STORAGE_KEY);
                sessionStorage.removeItem(COLLAPSED_STORAGE_KEY);
                sessionStorage.removeItem(LIVE_STORAGE_KEY);
              } catch {}
              setMessages(INITIAL_MSG);
              setLiveSteps([]);
              setCollapsedSteps({});
              setEmailSent({});
            }}
            disabled={loading}
            title="대화 삭제"
            style={{
              marginLeft: "auto",
              background: "none", border: "none",
              color: "rgba(255,255,255,0.3)", fontSize: 11,
              cursor: loading ? "default" : "pointer", padding: "0 4px", lineHeight: 1,
              opacity: loading ? 0.3 : 1,
            }}
          >
            🗑
          </button>
          <button onClick={onClose} style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.3)", fontSize: 14,
            cursor: "pointer", padding: "0 2px", lineHeight: 1,
          }}>✕</button>
        </div>

        {/* 프리셋 */}
        <div style={{
          padding: "8px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          display: "flex", gap: 5, flexWrap: "wrap", flexShrink: 0,
        }}>
          {PRESETS.map(({ label, q, multi }) => {
            const disabled = loading || (multi && !selected?.lat);
            return (
              <button key={label} onClick={() => sendChat(q)} disabled={disabled} style={{
                padding: "4px 10px", fontSize: 11, borderRadius: 5,
                border: multi ? "1px solid rgba(120,200,255,0.2)" : "1px solid rgba(255,255,255,0.08)",
                background: multi ? "rgba(80,160,255,0.07)" : "rgba(255,255,255,0.04)",
                color: disabled ? "rgba(255,255,255,0.18)" : multi ? "rgba(120,200,255,0.8)" : "rgba(255,255,255,0.5)",
                cursor: disabled ? "default" : "pointer",
                fontFamily: "inherit",
              }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* 메시지 영역 */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {messages.map((m, idx) =>
            m.role === "multi_group" ? (
              <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "98%" }}>

                {/* 교차로 탐색 과정 (좌표 자동검색 시) */}
                {m.preSteps?.length > 0 && (
                  <InlineSteps
                    steps={m.preSteps}
                    label={`교차로 탐색 과정 · ${m.preSteps.length}단계`}
                    collapsed={collapsedSteps[`${idx}-pre`] === true}
                    onToggle={() => setCollapsedSteps(p => ({ ...p, [`${idx}-pre`]: !p[`${idx}-pre`] }))}
                  />
                )}

                {/* 워커 분석 블록 — InlineSteps 스타일 */}
                {(m.loadingWorkers || m.workers.length > 0) && (() => {
                  const wKey = `${idx}-workers`;
                  const wCollapsed = collapsedSteps[wKey] ?? false;
                  const allDone = !m.loadingWorkers && m.workers.every(w => !w.loading);
                  return (
                    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                      <button onClick={() => setCollapsedSteps(p => ({ ...p, [wKey]: !p[wKey] }))} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
                        background: "rgba(255,255,255,0.025)", border: "none", cursor: "pointer",
                        color: "rgba(255,255,255,0.38)", fontSize: 11, textAlign: "left", fontFamily: "system-ui,sans-serif",
                      }}>
                        {!allDone && <span style={{ display: "inline-flex", gap: 2, alignItems: "center", marginRight: 2 }}>
                          {[0,1,2].map(i => <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.45)", display: "inline-block", animation: `chatDotBlink 1.2s ease ${i*0.2}s infinite` }} />)}
                        </span>}
                        {allDone && <span style={{ fontSize: 8, transition: "transform .2s", transform: wCollapsed ? "rotate(-90deg)" : "none", display: "inline-block" }}>▾</span>}
                        {allDone ? `에이전트 분석 · ${m.workers.length}개` : `에이전트 분석 중${m.workers.length > 0 ? ` · ${m.workers.length}개` : ""}`}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{m.centerName}</span>
                      </button>
                      {(!wCollapsed || !allDone) && (
                        <div style={{ padding: "6px 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                          {m.workers.map(w => (
                            <div key={w.worker_id} style={{ display: "flex", gap: 10, animation: "chatFadeIn .15s ease" }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", minWidth: 52, flexShrink: 0, paddingTop: 1, fontFamily: "system-ui,sans-serif" }}>
                                W{w.worker_id} {w.direction}
                              </span>
                              <span style={{ fontSize: 10, color: w.loading ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.48)", lineHeight: 1.55, fontFamily: "system-ui,sans-serif" }}>
                                {w.loading ? "분석 중..." : (w.content.length > 120 ? w.content.slice(0, 120) + "…" : w.content)}
                              </span>
                            </div>
                          ))}
                          {m.loadingWorkers && m.workers.length === 0 && (
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "system-ui,sans-serif" }}>인근 교차로 조회 중...</div>
                          )}
                        </div>
                      )}
                      {!allDone && <div style={{ height: 1, background: "rgba(255,255,255,0.04)" }}><div style={{ height: "100%", background: "rgba(255,255,255,0.14)", animation: "chatProgressBar 2.4s ease infinite" }} /></div>}
                    </div>
                  );
                })()}

                {/* 3라운드 토론 블록 */}
                {[
                  { num: 1, label: "토론 1라운드 · 문제 파악" },
                  { num: 2, label: "토론 2라운드 · 수치 제안" },
                  { num: 3, label: "토론 3라운드 · 합의" },
                ].map(({ num, label }) => {
                  const items = (m.discussions || []).filter(d => d.round === num);
                  const isActive = m.currentRound === num && m.loadingDiscuss;
                  const allDone = items.length > 0 && items.every(d => !d.loading) && !isActive;
                  if (items.length === 0 && !isActive) return null;
                  const rKey = `${idx}-r${num}`;
                  const rCollapsed = collapsedSteps[rKey] ?? false;
                  return (
                    <div key={`round-${num}`} style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                      <button onClick={() => allDone && setCollapsedSteps(p => ({ ...p, [rKey]: !p[rKey] }))} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
                        background: "rgba(255,255,255,0.025)", border: "none", cursor: allDone ? "pointer" : "default",
                        color: "rgba(255,255,255,0.38)", fontSize: 11, textAlign: "left", fontFamily: "system-ui,sans-serif",
                      }}>
                        {!allDone && <span style={{ display: "inline-flex", gap: 2, alignItems: "center", marginRight: 2 }}>
                          {[0,1,2].map(i => <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.45)", display: "inline-block", animation: `chatDotBlink 1.2s ease ${i*0.2}s infinite` }} />)}
                        </span>}
                        {allDone && <span style={{ fontSize: 8, transition: "transform .2s", transform: rCollapsed ? "rotate(-90deg)" : "none", display: "inline-block" }}>▾</span>}
                        {allDone ? `${label} · ${items.length}개` : label}
                      </button>
                      {(!rCollapsed || !allDone) && (
                        <div style={{ padding: "6px 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                          {items.map(d => (
                            <div key={`d-${d.round}-${d.worker_id}`} style={{ display: "flex", gap: 10, animation: "chatFadeIn .15s ease" }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", minWidth: 52, flexShrink: 0, paddingTop: 1, fontFamily: "system-ui,sans-serif" }}>
                                W{d.worker_id} {d.direction}
                              </span>
                              <span style={{ fontSize: 10, color: d.loading ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.48)", lineHeight: 1.55, fontFamily: "system-ui,sans-serif" }}>
                                {d.loading ? "작성 중..." : (d.content.length > 140 ? d.content.slice(0, 140) + "…" : d.content)}
                              </span>
                            </div>
                          ))}
                          {isActive && items.length === 0 && (
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "system-ui,sans-serif" }}>대기 중...</div>
                          )}
                        </div>
                      )}
                      {!allDone && <div style={{ height: 1, background: "rgba(255,255,255,0.04)" }}><div style={{ height: "100%", background: "rgba(255,255,255,0.14)", animation: "chatProgressBar 2.4s ease infinite" }} /></div>}
                    </div>
                  );
                })}

                {/* 오케스트레이터 — 일반 AI 답변처럼 */}
                {m.loadingOrch && (
                  <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "rgba(255,255,255,0.025)", color: "rgba(255,255,255,0.38)", fontSize: 11, fontFamily: "system-ui,sans-serif" }}>
                      <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                        {[0,1,2].map(i => <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.45)", display: "inline-block", animation: `chatDotBlink 1.2s ease ${i*0.2}s infinite` }} />)}
                      </span>
                      <span style={{ marginLeft: 2 }}>종합 분석 중</span>
                    </div>
                    <div style={{ height: 1, background: "rgba(255,255,255,0.04)" }}><div style={{ height: "100%", background: "rgba(255,255,255,0.14)", animation: "chatProgressBar 2.4s ease infinite" }} /></div>
                  </div>
                )}
                {m.orchestrator && (
                  <div style={{ fontSize: 13, lineHeight: 1.75, color: "rgba(255,255,255,0.82)", whiteSpace: "pre-line", padding: "2px 2px 0" }}>
                    {m.orchestrator}
                  </div>
                )}
                {m.error && (
                  <div style={{ fontSize: 11, color: "rgba(255,100,100,0.7)", paddingLeft: 4 }}>오류: {m.error}</div>
                )}
              </div>
            ) : m.role === "user" ? (
              <div key={idx} style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{
                  maxWidth: "80%", padding: "9px 13px",
                  borderRadius: "12px 12px 3px 12px",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  fontSize: 13, lineHeight: 1.7,
                  color: "rgba(255,255,255,0.82)", whiteSpace: "pre-line",
                }}>
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "92%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 2 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>AI</span>
                  {/* 개별 메시지 TTS 재생 버튼 */}
                  {GOOGLE_TTS_KEY && (
                    <button
                      onClick={() => speakText(m.text)}
                      title="음성으로 듣기"
                      style={{
                        background: "none", border: "none",
                        color: "rgba(255,255,255,0.25)", fontSize: 11,
                        cursor: "pointer", padding: "0 2px",
                      }}
                    >
                      🔊
                    </button>
                  )}
                </div>
                <InlineSteps
                  steps={m.steps}
                  collapsed={collapsedSteps[idx] === true}
                  onToggle={() => toggleStep(idx)}
                />
                <div style={{
                  padding: "9px 13px",
                  borderRadius: "3px 12px 12px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 13, lineHeight: 1.8,
                  color: "rgba(255,255,255,0.72)", whiteSpace: "pre-line",
                }}>
                  {m.text}
                </div>
                {/* 이메일 발송 버튼 — 로그인 상태이고 초기 인사 메시지가 아닐 때만 표시 */}
                {idx > 0 && JSON.parse(localStorage.getItem("ts_user") || "{}").email && (
                  <div style={{ paddingLeft: 2 }}>
                    {emailSent[idx] === "sent" ? (
                      <span style={{ fontSize: 11, color: "rgba(100,200,120,0.7)" }}>✓ 이메일 발송 완료</span>
                    ) : emailSent[idx] === "error" ? (
                      <span style={{ fontSize: 11, color: "rgba(255,100,100,0.7)" }}>발송 실패 — 다시 시도</span>
                    ) : (
                      <button
                        disabled={emailSent[idx] === "sending"}
                        onClick={async () => {
                          const userEmail = JSON.parse(localStorage.getItem("ts_user") || "{}").email;
                          if (!userEmail) return;
                          setEmailSent(prev => ({ ...prev, [idx]: "sending" }));
                          try {
                            const res = await fetch(`${API_BASE}/api/email/send`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                to: userEmail,
                                subject: "[Syncro] 분석결과를 알려드립니다",
                                body: m.text,
                              }),
                            });
                            setEmailSent(prev => ({ ...prev, [idx]: res.ok ? "sent" : "error" }));
                          } catch {
                            setEmailSent(prev => ({ ...prev, [idx]: "error" }));
                          }
                        }}
                        style={{
                          padding: "3px 10px", fontSize: 11, borderRadius: 5,
                          border: "1px solid rgba(255,255,255,0.1)",
                          background: emailSent[idx] === "sending" ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)",
                          color: emailSent[idx] === "sending" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)",
                          cursor: emailSent[idx] === "sending" ? "default" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {emailSent[idx] === "sending" ? "발송 중..." : "📧 이메일로 받기"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          )}

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "92%" }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", paddingLeft: 2 }}>AI</span>
              <ThinkingBlock steps={liveSteps} />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* 입력 영역 */}
        <div style={{
          padding: "10px 16px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", gap: 7, flexShrink: 0, alignItems: "center",
        }}>
          {/* 마이크 버튼 */}
          <button
            onClick={toggleMic}
            disabled={loading}
            title={listening ? "음성 인식 중단" : "음성으로 말하기"}
            style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              border: listening
                ? "1px solid rgba(255,80,80,0.6)"
                : "1px solid rgba(255,255,255,0.1)",
              background: listening
                ? "rgba(255,60,60,0.18)"
                : "rgba(255,255,255,0.05)",
              color: listening ? "rgba(255,100,100,0.9)" : "rgba(255,255,255,0.45)",
              fontSize: 13, cursor: loading ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: listening ? "micPulse 1s ease infinite" : "none",
              opacity: loading ? 0.4 : 1,
            }}
          >
            {listening ? "⏹" : "🎤"}
          </button>

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !loading && sendChat()}
            placeholder={listening ? "듣는 중..." : "자유롭게 질문하세요..."}
            disabled={loading || listening}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.05)",
              border: listening
                ? "1px solid rgba(255,80,80,0.3)"
                : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8, padding: "9px 13px",
              color: "rgba(255,255,255,0.82)", fontSize: 13,
              outline: "none", fontFamily: "inherit",
              opacity: loading ? 0.5 : 1,
            }}
          />
          {loading ? (
            <button onClick={stopGeneration} style={{
              padding: "9px 14px", borderRadius: 8,
              background: "rgba(255,60,60,0.15)",
              border: "1px solid rgba(255,60,60,0.35)",
              color: "rgba(255,110,110,0.9)",
              fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "rgba(255,100,100,0.9)", display: "inline-block" }} />
              정지
            </button>
          ) : (
            <button onClick={() => sendChat()} style={{
              padding: "9px 16px", borderRadius: 8,
              background: "rgba(255,255,255,0.09)",
              border: "1px solid rgba(255,255,255,0.09)",
              color: "rgba(255,255,255,0.7)",
              fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              전송
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes chatDotBlink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
        @keyframes chatProgressBar {
          0%   { width: 0%; }
          60%  { width: 75%; }
          100% { width: 92%; }
        }
        @keyframes chatFadeIn {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes micPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,60,60,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(255,60,60,0); }
        }
        @keyframes mapPingPulse {
          0%   { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
          60%  { transform: translate(-50%,-50%) scale(2.8); opacity: 0.1; }
          100% { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
        }
      `}</style>
    </>
  );
}
