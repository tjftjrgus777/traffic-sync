/**
 * useAssistant — AI 어시스턴트 통합 훅
 * ==================================================================
 * 음성 대화(박수)와 구 분석 브리핑(구 클릭)을 하나의 대화 패널(voiceUI)로
 * 통합 관리한다. 두 흐름 모두 voiceUI.messages에 누적되므로, 패널을 닫았다
 * 다시 열어도(AI 버튼) 이전 대화가 그대로 보인다.
 *
 * 담당 기능
 *   1) 박수 2번 / AI 버튼 → 음성 대화 세션 (runVoiceSession)
 *   2) 구 선택 → 분석 브리핑 (runBriefing) — 같은 패널에 누적
 *   3) 시작 확인 팝업 (pendingBriefing)
 *   4) TTS 음소거 토글
 *   5) 분석 중 페이지 이동 차단 (isAnalyzing / tryNav)
 *
 * voiceUI.status 상태 머신:
 *   greeting → listening → thinking → speaking → email_confirm → done
 *   (idle = 대기, active=false면 패널 닫힘이지만 messages는 보존)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useClapDetection } from './useClapDetection'
import { speakAsync, stopAllTTS, setTTSMuted, isTTSMuted, whenTTSIdle } from '../lib/tts'
import { listenOnce } from '../lib/speech'

const PYTHON_BASE = (import.meta.env.VITE_PYTHON_URL || 'http://localhost:8001').replace(/\/+$/, '')
const API_BASE    = (import.meta.env.VITE_API_URL    || 'http://localhost:8080').replace(/\/+$/, '')

// 마이크/세션을 새로 시작하면 안 되는 "AI가 일하는 중" 상태들
const BUSY_STATUS = ['thinking', 'speaking', 'greeting']

const INITIAL_VOICE_UI = { active: false, messages: [], steps: [], status: 'idle', report: '' }

// 로컬스토리지의 로그인 유저 정보 안전하게 읽기
function readUser() {
  try { return JSON.parse(localStorage.getItem('ts_user') || '{}') } catch { return {} }
}

export function useAssistant({ page, onNavIntent }) {
  // ── 상태 ─────────────────────────────────────────────────────────
  // 캐시 로그인으로 바로 진입했을 때도 시작 확인 팝업을 띄움
  const [pendingBriefing, setPendingBriefing] = useState(() => {
    const cached = localStorage.getItem('ts_user')
    if (!cached) return null
    try {
      const user = JSON.parse(cached)
      return { name: user.name || '관제사', gu: '강남구' }
    } catch { return null }
  })
  const [isMuted, setIsMuted]               = useState(false)
  const [voiceUI, setVoiceUI]               = useState(INITIAL_VOICE_UI)  // 통합 대화 패널
  const [voiceMinimized, setVoiceMinimized] = useState(false)
  const [voiceSTTActive, setVoiceSTTActive] = useState(false)
  const [navBlockMsg, setNavBlockMsg]       = useState('')

  // ── refs ─────────────────────────────────────────────────────────
  const msgEndRef        = useRef(null)   // 메시지 자동 스크롤
  const emailConfirmRef  = useRef(null)   // 이메일 확인 Promise resolver
  const voiceInputRef    = useRef(null)   // STT 결과 resolver (버튼·자동 공용)
  const voiceSessionRef  = useRef(null)   // runVoiceSession (clap에서 TDZ 없이 참조)
  const runBriefingRef   = useRef(null)   // runBriefing (pendingBriefing 효과에서 참조)
  const abortRef         = useRef(null)   // 진행 중인 스트리밍 fetch 중단용
  const sttRecRef        = useRef(null)   // 현재 SpeechRecognition 인스턴스
  const sessionAbortedRef = useRef(false) // 패널 닫힘 여부 (dangling TTS 콜백 차단용)
  const startVoiceSTTRef  = useRef(null)  // 최신 startVoiceSTT 참조 (setTimeout 클로저 갱신)

  // 실제 AI 추론 중일 때만 이동 차단 (TTS 재생/대기 중엔 이동 허용)
  const isAnalyzing = voiceUI.active && voiceUI.status === 'thinking'

  // ── 음소거 ──────────────────────────────────────────────────────
  const toggleMute = () => {
    const next = !isTTSMuted()
    setTTSMuted(next)   // 음소거 시 진행 중 발화도 중단
    setIsMuted(next)
  }


  // ── 페이지 이동 차단 ────────────────────────────────────────────
  const blockNav = () => {
    setNavBlockMsg('분석 중에는 다른 페이지로 이동할 수 없습니다.')
    setTimeout(() => setNavBlockMsg(''), 2500)
  }
  const tryNav = (fn) => { if (isAnalyzing) { blockNav(); return } fn() }

  // ── 마이크 STT 시작/중단 토글 ───────────────────────────────────
  const startVoiceSTT = () => {
    console.log('[STT] startVoiceSTT 호출, status:', voiceUI.status, 'voiceSTTActive:', voiceSTTActive)
    if (voiceMinimized) return                        // 최소화 상태에서 STT 금지 (TTS 소리 유입 방지)
    if (BUSY_STATUS.includes(voiceUI.status)) { console.log('[STT] BUSY 상태로 차단:', voiceUI.status); return }
    if (voiceUI.status === 'email_confirm') return    // 이메일 확인 중엔 버튼으로만

    if (voiceSTTActive) {  // 이미 켜져 있으면 중단
      sttRecRef.current?.abort()
      sttRecRef.current = null
      setVoiceSTTActive(false)
      setVoiceUI(prev => ({ ...prev, status: 'idle' }))
      return
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { console.log('[STT] SpeechRecognition 미지원'); return }
    const r = new SR()
    r.lang = 'ko-KR'; r.maxAlternatives = 1
    sttRecRef.current = r
    setVoiceSTTActive(true)
    setVoiceUI(prev => ({ ...prev, status: 'listening' }))
    console.log('[STT] r.start() 호출')

    r.onresult = (e) => {
      const text = e.results[0][0].transcript
      sttRecRef.current = null
      setVoiceSTTActive(false)
      setVoiceUI(prev => ({ ...prev, status: 'idle' }))
      if (voiceInputRef.current) {
        // waitForVoiceInput이 대기 중 — 정상 세션 흐름
        voiceInputRef.current(text)
        voiceInputRef.current = null
      } else if (emailConfirmRef.current) {
        // 이메일 확인 대기 중 — 음성으로 네/아니요 처리 (새 질문으로 보내지 않음)
        const wantsEmail = /네|응|보내|받아|좋아|줘/.test(text)
        emailConfirmRef.current(wantsEmail)
        emailConfirmRef.current = null
      } else if (text.trim()) {
        // 세션 없이 마이크를 직접 눌러 말했을 때 — 텍스트 표시 후 AI 전달
        sessionAbortedRef.current = false
        const user = readUser()
        setVoiceUI(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'user', text }],
          steps: [], status: 'thinking',
        }))
        streamAgent({
          endpoint: '/api/agent/chat/stream',
          body: { question: text, userEmail: user.email || null },
          skipEmailConfirm: false,
          onError: async () => { await speakAsync('처리 중 오류가 발생했습니다.') },
        })
      }
    }
    r.onerror = (e) => {
      console.log('[STT] 오류:', e.error, e.message)
      sttRecRef.current = null
      setVoiceSTTActive(false)
      setVoiceUI(prev => ({ ...prev, status: 'idle' }))
    }
    r.onend = () => {
      if (sttRecRef.current) sttRecRef.current = null
      setVoiceSTTActive(false)
      setVoiceUI(prev => prev.status === 'listening' ? { ...prev, status: 'idle' } : prev)
    }
    r.start()
  }

  // 매 렌더마다 최신 startVoiceSTT를 ref에 업데이트 (setTimeout 클로저 stale 방지)
  startVoiceSTTRef.current = startVoiceSTT

  // STT 결과를 Promise로 받기 — 버튼으로도, 자동으로도 resolve 가능
  // autoStartMs=null 이면 자동 시작 없이 버튼 클릭 대기
  const waitForVoiceInput = (autoStartMs = 600) => new Promise(resolve => {
    voiceInputRef.current = resolve
    if (autoStartMs != null) {
      setTimeout(() => {
        if (voiceInputRef.current) startVoiceSTTRef.current?.()
      }, autoStartMs)
    }
  })

  // ── 전역 박수 감지 → 음성 세션 시작/중단 ────────────────────────
  useClapDetection({
    enabled: false,
    onDoubleClap: useCallback(() => {
      if (window.__chatbotSpeaking) return
      if (page === 'map') return  // 지도 페이지는 지도 챗봇 훅이 처리
      const isPlaying = !!(window.__currentBriefingAudio && !window.__currentBriefingAudio.paused)
      if (isPlaying) { stopAllTTS(); return }  // 재생 중이면 멈추기만
      if (voiceUI.status === 'thinking') return  // 추론 중엔 새 세션 금지

      if (pendingBriefing) setPendingBriefing(null)  // 시작 확인 팝업 닫기
      emailConfirmRef.current?.(false)               // 대기 중인 이메일 확인은 아니요
      voiceSessionRef.current?.()
    }, [page, pendingBriefing, voiceUI.status]),
  })

  // ── 이메일 확인 버튼 ────────────────────────────────────────────
  const handleEmailConfirmClick = (confirmed) => {
    emailConfirmRef.current?.(confirmed)
    emailConfirmRef.current = null
  }

  // ── 패널 닫기/최소화 (대화 내용은 보존) ─────────────────────────
  const closeVoiceUI = () => {
    sessionAbortedRef.current = true  // dangling 콜백 차단
    abortRef.current?.abort()         // 진행 중 스트리밍 중단
    abortRef.current = null
    stopAllTTS()
    // waitForVoiceInput이 hang 중이면 null로 즉시 resolve (다음 세션 block 방지)
    voiceInputRef.current?.(null)
    voiceInputRef.current = null
    sttRecRef.current?.abort()
    sttRecRef.current = null
    setVoiceSTTActive(false)
    // email confirm Promise도 즉시 resolve
    emailConfirmRef.current?.(false)
    emailConfirmRef.current = null
    // active만 false로 — messages/report는 그대로 두어 다시 열면 보임
    setVoiceUI(prev => ({ ...prev, active: false, status: 'idle', steps: [] }))
    setVoiceMinimized(false)
  }
  const minimizeVoiceUI = () => setVoiceMinimized(true)

  // 헤더 마이크 버튼: 한 번 → 세션 시작, 한 번 더 → 완전 종료
  const toggleMicSession = () => {
    if (voiceUI.active) {
      closeVoiceUI()
    } else {
      voiceSessionRef.current?.()
    }
  }

  // AI 플로팅 버튼
  // - 패널 열려있을 때 클릭 → 최소화 + TTS 음소거 (AI는 백그라운드 유지)
  // - 최소화 상태일 때 클릭 → 패널 보이기 + TTS 음소거 해제
  //   + AI가 바쁘지 않으면 인사 TTS 재생
  // - 꺼져있을 때 클릭 → 새 세션 시작
  const onFloatingClick = () => {
    if (!voiceUI.active) {
      voiceSessionRef.current?.()      // 꺼져있으면 → 새 세션 시작
    } else if (voiceMinimized) {
      // 최소화 → 다시 열기 + TTS 음소거 해제
      setTTSMuted(false)
      setIsMuted(false)
      setVoiceMinimized(false)
      // AI가 바쁘지 않으면 인사 텍스트 + TTS → 끝나면 자동 STT
      if (!BUSY_STATUS.includes(voiceUI.status) && voiceUI.status !== 'email_confirm') {
        const user = readUser()
        const name = user.name || '관제사'
        const greeting = `안녕하세요 ${name}님, 무엇을 도와드릴까요?`
        setVoiceUI(prev => ({ ...prev, messages: [...prev.messages, { role: 'ai', text: greeting }], status: 'greeting' }))
        speakAsync(greeting).then(() => {
          if (!sessionAbortedRef.current) {
            setVoiceUI(prev => prev.status === 'greeting' ? { ...prev, status: 'idle' } : prev)
            setTimeout(() => {
              if (!sessionAbortedRef.current) startVoiceSTTRef.current?.()
            }, 100)
          }
        })
      }
    } else {
      // 패널 열려있을 때 → 최소화 + TTS 음소거 + STT 중단
      stopAllTTS()
      setTTSMuted(true)
      setIsMuted(true)
      sttRecRef.current?.abort()
      sttRecRef.current = null
      setVoiceSTTActive(false)
      setVoiceMinimized(true)
    }
  }

  // ── 박수/AI버튼 → 음성 대화 세션 ────────────────────────────────
  const runVoiceSession = async () => {
    const user  = readUser()
    const name  = user.name  || '관제사'
    const email = user.email || null
    sessionAbortedRef.current = false
    stopAllTTS()  // 이전 세션에서 남은 TTS 체인/오디오 완전 초기화

    // 패널 열기 — 항상 새 세션으로 초기화 (인사 + TTS + STT 순서)
    setVoiceMinimized(false)
    const greeting = `안녕하세요 ${name}님, AI 어시스턴트입니다. 무엇을 도와드릴까요?`
    setVoiceUI({ active: true, messages: [{ role: 'ai', text: greeting }], steps: [], status: 'greeting', report: '' })
    await speakAsync(greeting)
    // X가 눌렸으면 STT 자동 시작 전에 즉시 종료
    if (sessionAbortedRef.current) {
      setVoiceUI(prev => ({ ...prev, status: 'idle' }))
      return
    }
    // 인사 완료 후 idle로 전환해야 STT 자동 시작 가능
    setVoiceUI(prev => prev.status === 'greeting' ? { ...prev, status: 'idle' } : prev)

    // 사용자 발화 수집 — TTS 끝나면 자동 STT, 마이크 버튼으로도 가능
    const question = await waitForVoiceInput(600)
    // null = 패널 닫힘(closeVoiceUI가 resolve), 빈 문자열 = 인식 실패
    if (!question || sessionAbortedRef.current) {
      setVoiceUI(prev => ({ ...prev, status: 'idle' }))
      return
    }

    // 네비게이션 명령이면 AI 에이전트 대신 바로 처리
    if (onNavIntent) {
      try {
        const res = await fetch(`${PYTHON_BASE}/api/nav/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: question }),
        })
        const intent = await res.json()
        if (intent.action !== 'unknown') {
          setVoiceUI(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'user', text: question }],
            status: 'idle',
          }))
          const feedbackMsg = {
            navigate: { map: '지도로 이동합니다.', simulation: '시뮬레이션으로 이동합니다.', cctv: 'CCTV 페이지로 이동합니다.', news: '뉴스 페이지로 이동합니다.' },
            select_gu: `${intent.gu}을 선택했습니다.`,
            mypage: '마이페이지로 이동합니다.',
            logout: '로그아웃합니다.',
          }
          const msg = intent.action === 'navigate'
            ? feedbackMsg.navigate[intent.page]
            : feedbackMsg[intent.action]
          if (msg) await speakAsync(msg)
          if (!sessionAbortedRef.current) onNavIntent(intent)
          return
        }
      } catch { /* 의도 분류 실패 시 그냥 AI로 넘김 */ }
    }

    setVoiceUI(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', text: question }],
      steps: [], status: 'thinking',
    }))

    // X가 눌렸으면 스트리밍 시작하지 않음
    if (sessionAbortedRef.current) {
      setVoiceUI(prev => ({ ...prev, status: 'idle' }))
      return
    }

    // AI 스트리밍 — 분석 후 이메일 확인은 streamAgent 내부에서 처리
    await streamAgent({
      endpoint: '/api/agent/chat/stream',
      body: { question, userEmail: email },
      skipEmailConfirm: false,
      onError: async () => { await speakAsync('처리 중 오류가 발생했습니다.') },
    })

    // 추가 질문 루프 — 마이크 버튼으로만 시작 (자동 STT 없음)
    while (!sessionAbortedRef.current) {
      const nextQ = await waitForVoiceInput(null)  // 자동 시작 없이 버튼 대기
      if (!nextQ || sessionAbortedRef.current) break

      setVoiceUI(prev => ({
        ...prev,
        messages: [...prev.messages, { role: 'user', text: nextQ }],
        steps: [], status: 'thinking',
      }))
      if (sessionAbortedRef.current) break

      await streamAgent({
        endpoint: '/api/agent/chat/stream',
        body: { question: nextQ, userEmail: email },
        skipEmailConfirm: false,
        onError: async () => { await speakAsync('처리 중 오류가 발생했습니다.') },
      })
    }
  }
  voiceSessionRef.current = runVoiceSession

  // ── 구 단위 AI 브리핑 — 같은 패널에 누적 ────────────────────────
  const runBriefing = async (name, gu, isGuClick = false) => {
    sessionAbortedRef.current = false
    setVoiceMinimized(false)
    const intro = isGuClick
      ? `${gu} 교통 현황을 분석하겠습니다.`
      : `안녕하세요 ${name}님. ${gu} 교통 현황을 분석하겠습니다.`
    setVoiceUI(prev => ({
      ...prev,
      active: true,
      messages: [...prev.messages, { role: 'ai', text: intro }],
      steps: [], status: 'thinking', report: '',
    }))
    speakAsync(intro)

    if (sessionAbortedRef.current) return
    await streamAgent({
      endpoint: '/api/agent/district-report/stream',
      body: { district: gu },
      emailSubject: `[Syncro] ${gu} 분석결과를 알려드립니다`,
      onError: async () => { await speakAsync('교통 데이터 분석 중 오류가 발생했습니다.') },
    })
  }
  runBriefingRef.current = runBriefing

  // ── 공통 SSE 스트리밍 처리 ──────────────────────────────────────
  // 도구 단계 → voiceUI.steps, 최종 답변 → 메시지, 이후 이메일 확인까지 담당
  async function streamAgent({ endpoint, body, emailSubject, skipEmailConfirm = false, onError }) {
    if (sessionAbortedRef.current) return  // 이미 X가 눌린 상태면 fetch 시작 안 함
    const email = readUser().email || null
    const abortCtrl = new AbortController()
    abortRef.current = abortCtrl

    let reportText = ''
    let ttsSpeakPromise = Promise.resolve()  // answer TTS promise — 직접 추적
    let emailSentByAI = false  // AI가 send_email_report 도구로 이미 발송했는지
    try {
      const res = await fetch(`${PYTHON_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      })
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let data
          try { data = JSON.parse(line.slice(6)) } catch { continue }

          if (data.type === 'action' && data.label) {
            if (data.tool === 'send_email_report') emailSentByAI = true
            setVoiceUI(prev => ({ ...prev, steps: [...prev.steps, data] }))
            speakAsync(data.label, 1.4)
          } else if (data.type === 'observation') {
            setVoiceUI(prev => ({ ...prev, steps: [...prev.steps, data] }))
          } else if (data.type === 'answer') {
            reportText = data.content || ''
            if (reportText.trim()) {
              setVoiceUI(prev => ({
                ...prev,
                messages: [...prev.messages, { role: 'ai', text: reportText }],
                steps: [], status: 'speaking', report: reportText,
              }))
              ttsSpeakPromise = speakAsync(reportText)
            }
          }
        }
      }
    } catch (err) {
      abortRef.current = null
      if (err.name === 'AbortError') return  // 사용자가 닫아서 중단
      setVoiceUI(prev => ({ ...prev, messages: [...prev.messages, { role: 'ai', text: '처리 중 오류가 발생했습니다.' }], status: 'idle', steps: [] }))
      await onError?.()
      return
    }
    abortRef.current = null

    // answer 이벤트 없이 스트림이 끝난 경우 — 응답 없음 표시
    if (!reportText.trim()) {
      setVoiceUI(prev => ({ ...prev, steps: [], status: 'done' }))
      return
    }

    // answer TTS 완전히 끝날 때까지 대기 후 이메일 확인 표시
    await ttsSpeakPromise
    if (sessionAbortedRef.current) { setVoiceUI(prev => ({ ...prev, status: 'done' })); return }

    // AI가 이미 이메일을 보냈거나, 이메일 계정이 없거나, 스킵 플래그면 확인 생략
    if (emailSentByAI || skipEmailConfirm || !email) {
      setVoiceUI(prev => ({ ...prev, status: 'done' }))
      return
    }

    // 이메일 확인 — 버튼으로만 (음성 없음)
    const emailMsg = '이 리포트를 이메일로 보내드릴까요?'
    if (sessionAbortedRef.current) { setVoiceUI(prev => ({ ...prev, status: 'done' })); return }
    setVoiceUI(prev => ({ ...prev, messages: [...prev.messages, { role: 'ai', text: emailMsg }], status: 'email_confirm' }))
    const confirmed = await new Promise(res => {
      emailConfirmRef.current = res
      // closeVoiceUI가 이미 실행된 뒤에 이 라인에 도달했을 경우 즉시 취소
      if (sessionAbortedRef.current) { res(false); emailConfirmRef.current = null }
    })
    emailConfirmRef.current = null
    if (sessionAbortedRef.current) { setVoiceUI(prev => ({ ...prev, status: 'done' })); return }

    if (confirmed && email) {
      await fetch(`${API_BASE}/api/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, subject: emailSubject || '[Syncro] 분석결과를 알려드립니다', body: reportText }),
      })
      setVoiceUI(prev => ({ ...prev, messages: [...prev.messages, { role: 'user', text: '네' }, { role: 'ai', text: '이메일을 발송했습니다.' }], status: 'done' }))
      await speakAsync('이메일을 발송했습니다.')
    } else {
      setVoiceUI(prev => ({ ...prev, messages: [...prev.messages, { role: 'user', text: '아니요' }, { role: 'ai', text: '알겠습니다.' }], status: 'done' }))
      await speakAsync('알겠습니다.')
    }
  }

  // ── 메시지 자동 스크롤 ──────────────────────────────────────────
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [voiceUI.messages, voiceUI.steps])

  // ── pendingBriefing 팝업: TTS 끝나면 자동 STT (버튼도 동시 지원) ──
  useEffect(() => {
    const pb = pendingBriefing
    if (!pb) return
    let alive = true
    whenTTSIdle().then(async () => {
      if (!alive) return
      await new Promise(r => setTimeout(r, 400))
      if (!alive) return
      const said = await listenOnce(6000)
      if (!alive || !said) return
      if (/네|응|시작|분석|좋아|알았/.test(said)) {
        setPendingBriefing(null)
        runBriefingRef.current?.(pb.name, pb.gu)
      } else if (/아니|나중|괜찮/.test(said)) {
        speakAsync('알겠습니다.')
        setPendingBriefing(null)
      }
    })
    return () => { alive = false }
  }, [pendingBriefing])

  // ── 외부(App)에서 쓰는 트리거 ───────────────────────────────────
  // 구 클릭 시: "분석 시작할까요?" 안내 + 확인 팝업
  const promptGuBriefing = (name, guName) => {
    speakAsync(`${guName} 분석을 시작할까요?`)
    setPendingBriefing({ name, gu: guName })
  }
  // 로그인 직후: 시간대 인사 + 확인 팝업 (레거시 — 브리핑 카드가 대체)
  const greetOnLogin = (name, gu) => {
    const h = new Date().getHours()
    const tl = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : '저녁'
    speakAsync(`안녕하세요 ${name}님. ${tl} ${h}시입니다.`)
    setPendingBriefing({ name, gu })
  }
  // 브리핑 카드 닫힌 뒤 구 분석 팝업만 띄울 때 사용 (TTS 없음)
  const activatePendingBriefing = (name, gu) => {
    setPendingBriefing({ name, gu })
  }
  // pendingBriefing 팝업 버튼
  const acceptPendingBriefing = () => {
    const pb = pendingBriefing
    setPendingBriefing(null)
    if (pb) runBriefing(pb.name, pb.gu)
  }
  const dismissPendingBriefing = () => {
    speakAsync('알겠습니다.')
    setPendingBriefing(null)
  }

  return {
    // 라우팅 게이트
    isAnalyzing, tryNav, blockNav,
    // 음소거
    isMuted, toggleMute,
    // 트리거 (App에서 호출)
    promptGuBriefing, greetOnLogin, activatePendingBriefing,
    // 렌더 상태
    navBlockMsg, pendingBriefing, voiceUI, voiceMinimized, voiceSTTActive, msgEndRef,
    // 핸들러
    startVoiceSTT, stopAllTTS, minimizeVoiceUI, closeVoiceUI, onFloatingClick, toggleMicSession,
    handleEmailConfirmClick, acceptPendingBriefing, dismissPendingBriefing,
  }
}
