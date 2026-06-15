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
      background: 'linear-gradient(145deg, rgba(30,41,59,0.97), rgba(51,65,85,0.95))',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(147,197,253,0.42)', borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 22px 56px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.12), 0 0 28px rgba(96,165,250,0.2)',
      animation: 'brSlideIn .28s ease',
      fontFamily: 'system-ui,-apple-system,sans-serif',
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid rgba(147,197,253,0.18)', background: 'rgba(15,23,42,0.34)' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(135deg, #2563eb, #60a5fa)', border: '1px solid rgba(37,99,235,0.24)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0,
        }}>✦</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
            안녕하세요, {pending.name}님
          </div>
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 1 }}>
            AI 교통 어시스턴트
          </div>
        </div>
        <button onClick={onDismiss} style={{ background: 'rgba(226,232,240,0.1)', border: '1px solid rgba(226,232,240,0.12)', borderRadius: 8, color: '#cbd5e1', fontSize: 16, cursor: 'pointer', padding: '0 6px' }}>✕</button>
      </div>

      {/* 본문 */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 14, lineHeight: 1.6 }}>
          {pending.gu} 교통 현황 분석을 시작할까요?
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onStart} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'linear-gradient(135deg, #2563eb, #3b82f6)', border: '1px solid rgba(37,99,235,0.52)',
            color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 8px 18px rgba(37,99,235,0.24)',
          }}>시작</button>
          <button onClick={onDismiss} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13,
            background: 'rgba(15,23,42,0.46)', border: '1px solid rgba(147,197,253,0.14)',
            color: '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit',
          }}>나중에</button>
        </div>
      </div>
    </div>
  )
}
