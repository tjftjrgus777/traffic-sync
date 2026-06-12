/**
 * 음성 어시스턴트 패널 (GPT형 채팅 팝업)
 * ------------------------------------------------------------------
 * 박수 2번 또는 플로팅 버튼으로 열리는 대화형 팝업.
 * 인사 → 음성 질문 → AI 추론/응답 → 이메일 확인 흐름을 보여준다.
 * 모든 로직은 useAssistant 훅이 담당하고, 이 컴포넌트는 표시만 한다.
 *
 * props:
 *   voiceUI        : { status, messages, steps }
 *   voiceSTTActive : 마이크 활성 여부
 *   msgEndRef      : 메시지 자동 스크롤용 ref
 *   onStartSTT     : 마이크 토글
 *   onStopTTS      : TTS 정지
 *   onMinimize     : 패널 최소화
 *   onClose        : 패널 닫기
 *   onEmailConfirm : (boolean) 이메일 확인 버튼
 */
import { VOICE_STATUS_LABEL } from './assistantStyles'

// 마이크 사용이 막히는 상태 (AI가 처리/발화 중이거나 이메일 확인 대기 중)
const MIC_BLOCKED = ['thinking', 'speaking', 'greeting', 'email_confirm']

export default function VoiceAssistantPanel({
  voiceUI, voiceSTTActive, msgEndRef,
  onStartSTT, onStopTTS, onMinimize, onClose, onEmailConfirm,
}) {
  const micBlocked = MIC_BLOCKED.includes(voiceUI.status)
  const showProgress = voiceUI.status === 'thinking' || voiceUI.status === 'speaking'

  return (
    <div style={{
      position: 'fixed', bottom: 90, right: 28, zIndex: 10000,
      width: 390, maxHeight: '68vh',
      display: 'flex', flexDirection: 'column',
      background: 'rgba(9,9,11,0.97)',
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18,
      overflow: 'hidden',
      boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
      animation: 'brSlideIn .28s ease',
      fontFamily: 'system-ui,-apple-system,sans-serif',
    }}>
      {/* ── 헤더 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>✦</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.82)' }}>AI 교통 어시스턴트</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{VOICE_STATUS_LABEL[voiceUI.status]}</div>
        </div>

        {/* 마이크 토글 (AI 처리 중엔 비활성) */}
        <button onClick={onStartSTT} title={voiceSTTActive ? '마이크 중단' : '마이크로 말하기'} disabled={micBlocked}
          style={{
            background: voiceSTTActive ? 'rgba(255,60,60,0.2)' : micBlocked ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
            border: voiceSTTActive ? '1px solid rgba(255,60,60,0.5)' : '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6, padding: '4px 9px',
            cursor: micBlocked ? 'not-allowed' : 'pointer',
            color: voiceSTTActive ? 'rgba(255,100,100,0.9)' : micBlocked ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
            fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
            animation: voiceSTTActive ? 'micPulse 1s ease infinite' : 'none',
            opacity: micBlocked ? 0.4 : 1,
          }}>
          {voiceSTTActive ? '🔴 중단' : '🎤'}
        </button>

        {/* TTS 정지 */}
        <button onClick={onStopTTS} title="TTS 중지" style={{
          background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.25)',
          borderRadius: 6, padding: '4px 9px', color: 'rgba(255,110,110,0.8)',
          fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 1, background: 'rgba(255,100,100,0.85)', display: 'inline-block' }} /> TTS 정지
        </button>

        {/* 최소화 / 닫기 */}
        <button onClick={onMinimize} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.28)', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>−</button>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.28)', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✕</button>
      </div>

      {/* ── 메시지 영역 ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {voiceUI.messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '84%', padding: '9px 13px', fontSize: 13, lineHeight: 1.75,
              color: 'rgba(255,255,255,0.78)', whiteSpace: 'pre-line', wordBreak: 'break-word',
              borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '3px 12px 12px 12px',
              background: m.role === 'user' ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}>{m.text}</div>
          </div>
        ))}

        {/* 실시간 추론 단계 */}
        {voiceUI.steps.length > 0 && voiceUI.status === 'thinking' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 2px' }}>
            {voiceUI.steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, opacity: .65, flexShrink: 0, marginTop: 1 }}>{s.type === 'action' ? '🔧' : '↳'}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, wordBreak: 'break-all' }}>{(s.label || s.content || '').slice(0, 80)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 상태 인디케이터 */}
        {voiceUI.status === 'listening' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,100,100,0.85)', fontSize: 13, padding: '6px 0' }}>
            <span style={{ animation: 'micPulse 1s ease infinite', fontSize: 16 }}>🎤</span>
            말씀해주세요...
          </div>
        )}
        {showProgress && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '6px 0' }}>
            {[0, 1, 2].map(i => <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.3)', animation: `brDot 1.2s ease ${i * .2}s infinite`, display: 'inline-block' }} />)}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>{voiceUI.status === 'thinking' ? '분석 중...' : '읽는 중...'}</span>
          </div>
        )}

        <div ref={msgEndRef} />
      </div>

      {/* ── 이메일 확인 버튼 ── */}
      {voiceUI.status === 'email_confirm' && (
        <div style={{ padding: '10px 16px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginBottom: 8 }}>버튼으로 선택해주세요</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onEmailConfirm(true)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontFamily: 'inherit' }}>네</button>
            <button onClick={() => onEmailConfirm(false)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontFamily: 'inherit' }}>아니요</button>
          </div>
        </div>
      )}


      {/* ── 진행 바 ── */}
      {showProgress && (
        <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)', animation: 'brProgress 1.8s ease infinite' }} />
        </div>
      )}
    </div>
  )
}
