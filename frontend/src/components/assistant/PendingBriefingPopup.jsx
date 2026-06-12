/**
 * 구 분석 시작 확인 팝업
 * 로그인 직후 또는 구를 클릭했을 때 "분석을 시작할까요?"를 묻는다.
 * 버튼(시작/나중에) 또는 음성(STT)으로 응답할 수 있다 — STT는 상위 훅에서 처리.
 *
 * @param {{name:string, gu:string}} pending  대상 사용자/구 정보
 * @param {Function} onStart    "시작" 클릭
 * @param {Function} onDismiss  "나중에"/닫기 클릭
 */
export default function PendingBriefingPopup({ pending, onStart, onDismiss, shifted = false }) {
  if (!pending) return null
  // 보이스 패널(width 390, right 28)이 열려있으면 왼쪽으로 이동 (390 + 28 + 12 = 430)
  const rightOffset = shifted ? 430 : 28
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: rightOffset,
      zIndex: 10001, width: 360,
      transition: 'right 0.3s cubic-bezier(0.32,0.72,0,1)',
      background: 'rgba(12,12,14,0.96)',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      animation: 'brSlideIn .28s ease',
      fontFamily: 'system-ui,-apple-system,sans-serif',
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0,
        }}>✦</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
            안녕하세요, {pending.name}님
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
            AI 교통 어시스턴트
          </div>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: 16, cursor: 'pointer', padding: '0 2px' }}>✕</button>
      </div>

      {/* 본문 */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
          {pending.gu} 교통 현황 분석을 시작할까요?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onStart} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontFamily: 'inherit',
          }}>시작</button>
          <button onClick={onDismiss} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontFamily: 'inherit',
          }}>나중에</button>
        </div>
      </div>
    </div>
  )
}
