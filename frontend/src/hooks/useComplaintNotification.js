import { useEffect, useRef, useCallback } from 'react'

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/+$/, '')
const POLL_MS  = 2_000

/**
 * 2초마다 /api/complaints 를 폴링해 신규 "접수" 민원을 감지한다.
 * 최초 로드 시 현재 ID를 시드로 저장하여 기존 민원은 알림하지 않는다.
 * @param {(complaint: object) => void} onNew  신규 민원 콜백
 */
export function useComplaintNotification(onNew) {
  const seenIds = useRef(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/complaints`)
      if (!res.ok) return
      const data = await res.json()
      if (!Array.isArray(data)) return

      const pending = data.filter(c => c.status === '접수')

      if (seenIds.current === null) {
        seenIds.current = new Set(pending.map(c => c.id))
        return
      }

      for (const c of pending) {
        if (!seenIds.current.has(c.id)) {
          seenIds.current.add(c.id)
          onNew(c)
        }
      }
    } catch { /* 네트워크 오류 무시 */ }
  }, [onNew])

  useEffect(() => {
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll])
}
