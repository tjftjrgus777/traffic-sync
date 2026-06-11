import { useEffect, useRef, useState } from 'react'
import { speakAsync, stopAllTTS } from '../lib/tts'
import { V } from '../constants/theme'

export default function LoginBriefingCard({ briefing, onClose, onTTSDone }) {
  const { name, gu, weatherDesc, temp, pendingCount } = briefing

  const now    = new Date()
  const hh     = String(now.getHours()).padStart(2, '0')
  const mm     = String(now.getMinutes()).padStart(2, '0')
  const timeStr = `${hh}시 ${mm}분`

  const [pos, setPos]         = useState({ x: 0, y: 0 })
  const [moved, setMoved]     = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef(null)

  const onMouseDown = (e) => {
    if (e.target.closest('button')) return
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e) => {
      const dx = e.clientX - dragStart.current.mx
      const dy = e.clientY - dragStart.current.my
      setPos({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy })
      setMoved(true)
    }
    const up = () => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging])

  useEffect(() => {
    const text =
      `안녕하세요 ${name}님, 관리자 계정 접속 ${timeStr}에 인증되었습니다. ` +
      `현재 ${gu} 날씨는 ${weatherDesc}, 기온 ${temp}입니다. ` +
      `미처리 민원이 ${pendingCount}건 있습니다.`

    speakAsync(text).then(() => onTTSDone?.())

    return () => stopAllTTS()
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, pointerEvents: 'none' }}>
      <style>{`
        @keyframes briefingSlideUp {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 30px)) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>

      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute',
          top:  `calc(50% + ${pos.y}px)`,
          left: `calc(50% + ${pos.x}px)`,
          transform: 'translate(-50%, -50%)',
          width: 340, maxWidth: 'calc(100vw - 32px)',
          background: V.bg1,
          border: `1px solid rgba(194,81,12,0.4)`,
          borderRadius: 8,
          boxShadow: '0 16px 56px rgba(0,0,0,0.5)',
          pointerEvents: 'auto',
          cursor: dragging ? 'grabbing' : 'grab',
          animation: !moved
            ? 'briefingSlideUp 0.45s cubic-bezier(0.16,1,0.3,1) forwards'
            : 'none',
          userSelect: 'none',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '16px 18px 12px',
          borderBottom: `1px solid ${V.line}`,
        }}>
          <div>
            <div style={{ fontFamily: V.mono, fontSize: 9, color: V.ink2, letterSpacing: '1.2px', marginBottom: 6 }}>
              DAILY BRIEFING
            </div>
            <div style={{ fontFamily: V.sans, fontSize: 15, fontWeight: 700, color: V.ink0 }}>
              안녕하세요, {name}님
            </div>
            <div style={{ fontFamily: V.sans, fontSize: 12, color: V.ink1, marginTop: 3 }}>
              관리자 계정 접속 인증 · {timeStr}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, background: 'transparent',
              border: `1px solid ${V.line}`, borderRadius: 4,
              color: V.ink2, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, marginTop: 2,
            }}
          >✕</button>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px',
          borderBottom: `1px solid ${V.line}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: V.mono, fontSize: 10, color: V.ink2, letterSpacing: '.5px' }}>현재</span>
            <span style={{ fontFamily: V.sans, fontSize: 13, color: V.ink1 }}>{gu}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: V.sans, fontSize: 13, color: V.ink1 }}>{weatherDesc}</span>
            <span style={{ fontFamily: V.mono, fontSize: 15, fontWeight: 700, color: V.org }}>{temp}</span>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px',
        }}>
          <span style={{ fontFamily: V.sans, fontSize: 13, color: V.ink1 }}>미처리 민원</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: V.mono, fontSize: 15, fontWeight: 700, color: V.ink0 }}>
              {pendingCount}건
            </span>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: pendingCount > 0 ? V.org : V.ink2,
              display: 'inline-block',
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}
