import { useEffect, useRef } from 'react'
import { speakAsync } from '../../lib/tts'

const MAX_VISIBLE = 8
const POPUP_HEIGHT = 180  // PendingBriefingPopup 높이 추정값

export default function ComplaintNotificationBanner({ queue, onDismiss, isMuted = false, popupOpen = false }) {
  const spokenRef = useRef(new Set())

  useEffect(() => {
    if (!queue || queue.length === 0) return
    const latest = queue[queue.length - 1]
    if (spokenRef.current.has(latest.id)) return
    spokenRef.current.add(latest.id)
    if (!isMuted) {
      const gu  = latest.guName   ? `${latest.guName} `   : ''
      const cat = latest.category ? `${latest.category} ` : ''
      speakAsync(`${gu}${cat}민원이 접수되었습니다.`)
    }
  }, [queue, isMuted])

  if (!queue || queue.length === 0) return null

  // 최신 알림이 위에 쌓이도록 역순 정렬
  const visible  = queue.slice(-MAX_VISIBLE).reverse()
  const hiddenCt = Math.max(0, queue.length - MAX_VISIBLE)

  // 팝업이 열리면 알림을 팝업 위로 올림
  const bottomOffset = popupOpen ? 28 + POPUP_HEIGHT + 12 : 32

  return (
    <>
      <style>{`
        @keyframes cbnIn {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes bellRing {
          0%   { transform: rotate(0deg); }
          15%  { transform: rotate(18deg); }
          30%  { transform: rotate(-16deg); }
          45%  { transform: rotate(12deg); }
          60%  { transform: rotate(-8deg); }
          75%  { transform: rotate(4deg); }
          100% { transform: rotate(0deg); }
        }
      `}</style>

      <div style={{
        position:      'fixed',
        bottom:        bottomOffset,
        right:         32,
        zIndex:        10002,
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        width:         360,
        maxHeight:     'calc(100vh - 120px)',
        overflowY:     'auto',
        overflowX:     'hidden',
        fontFamily:    "'Pretendard','Noto Sans KR',system-ui,sans-serif",
        pointerEvents: 'none',
        scrollbarWidth: 'none',
        transition:    'bottom 0.3s cubic-bezier(0.32,0.72,0,1)',
      }}>

        {hiddenCt > 0 && (
          <div style={{
            fontSize:   11,
            color:      '#5a5a5a',
            padding:    '2px 6px',
            fontFamily: "'IBM Plex Mono',monospace",
          }}>
            ↑ 이전 알림 {hiddenCt}개 더
          </div>
        )}

        {visible.map((c, idx) => {
          const isNewest = idx === 0
          return (
            <div key={c.id} style={{
              pointerEvents: 'auto',
              animation:     isNewest ? 'cbnIn 0.3s ease' : 'none',
            }}>

              {/* 알림 카드 */}
              <div style={{
                display:      'flex',
                alignItems:   'flex-start',
                gap:          12,
                padding:      '14px 15px',
                background:   'linear-gradient(135deg, rgba(255,250,232,0.98) 0%, rgba(255,238,199,0.96) 100%)',
                border:       '1px solid rgba(255,170,51,0.72)',
                borderLeft:   '5px solid #ffaa33',
                borderRadius: 8,
                boxShadow:    '0 18px 42px rgba(0,0,0,0.48), 0 0 0 1px rgba(255,255,255,0.72), 0 0 24px rgba(255,170,51,0.28)',
              }}>

                {/* 종 아이콘 (테두리/배경 없음) */}
                <div style={{
                  flexShrink:     0,
                  fontSize:       22,
                  lineHeight:     1,
                  marginTop:      2,
                  color:          '#b45309',
                  animation:      isNewest ? 'bellRing 0.7s ease 0.1s' : 'none',
                }}>
                  🔔
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize:      11,
                    color:         '#b45309',
                    fontWeight:    700,
                    letterSpacing: '0.1em',
                    marginBottom:  5,
                    fontFamily:    "'IBM Plex Mono',monospace",
                    textTransform: 'uppercase',
                  }}>
                    NEW · 민원 접수
                  </div>
                  <div style={{
                    fontSize:     15,
                    color:        '#111827',
                    fontWeight:   700,
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}>
                    {[c.guName, c.category].filter(Boolean).join(' · ') || '민원 접수'}
                  </div>
                  {c.title && (
                    <div style={{
                      fontSize:     12,
                      color:        '#475569',
                      marginTop:    4,
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:   'nowrap',
                    }}>{c.title}</div>
                  )}
                </div>

                <button
                  onClick={() => onDismiss(c.id)}
                  style={{
                    flexShrink:     0,
                    width:          26,
                    height:         26,
                    borderRadius:   '50%',
                    background:     'rgba(255,255,255,0.55)',
                    border:         '1px solid rgba(180,83,9,0.25)',
                    color:          '#92400e',
                    cursor:         'pointer',
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    fontSize:       13,
                    padding:        0,
                    transition:     'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#ffaa33'
                    e.currentTarget.style.color = '#7c2d12'
                    e.currentTarget.style.background = 'rgba(255,170,51,0.22)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(180,83,9,0.25)'
                    e.currentTarget.style.color = '#92400e'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.55)'
                  }}
                >✕</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
