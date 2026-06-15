/**
 * App — 애플리케이션 최상위 컴포넌트
 * ==================================================================
 * React Router 없이 useState(page)로 화면을 전환하는 단일 페이지 구조.
 * URL은 바뀌지 않고 page 값에 따라 렌더링할 화면이 결정된다.
 *
 * VWorld 3D 지도는 unmount/remount 과정에서 전역 viewer가 꼬일 수 있으므로
 * SimulationDashboard는 한 번 진입한 뒤에는 unmount하지 않고 display만 전환한다.
 */
import { useState, useRef, useCallback, useEffect } from 'react'

import LoginPage from './pages/LoginPage'
import MyPage from './pages/mypage/MyPage'
import MainDashboard from './pages/MainDashboard'
import MapDashboard from './pages/MapDashboard'
import CctvDashboard from './pages/CctvDashboard'
import SimulationDashboard from './pages/SimulationDashboard'
import NewsDashboard from './pages/NewsDashboard'
import ComplaintManagePage from './pages/ComplaintManagePage'
import CivilApp from './pages/civil/CivilApp'

import { useWebSocket } from './hooks/useWebSocket'
import { useAssistant } from './hooks/useAssistant'
import { speakAsync, stopAllTTS } from './lib/tts'
import LoginBriefingCard from './components/LoginBriefingCard'
import { GU_LIST } from './constants/seoulGeoData'

import NavBlockToast from './components/assistant/NavBlockToast'
import VoiceAssistantPanel from './components/assistant/VoiceAssistantPanel'
import AIFloatingButton from './components/assistant/AIFloatingButton'
import PendingBriefingPopup from './components/assistant/PendingBriefingPopup'
import { AssistantKeyframes } from './components/assistant/assistantStyles'
import ComplaintNotificationBanner from './components/common/ComplaintNotificationBanner'
import { useComplaintNotification } from './hooks/useComplaintNotification'

export default function App() {
  // localStorage에 로그인 정보 있으면 바로 메인, 없으면 로그인 페이지
  const [page, setPage] = useState(() =>
    localStorage.getItem('ts_user') ? 'main' : 'login'
  )
  const [themeMode, setThemeMode] = useState('dark')

  useEffect(() => {
    document.documentElement.dataset.syncroTheme = themeMode
    localStorage.removeItem('syncro_theme')
  }, [themeMode])

  const toggleThemeMode = useCallback(() => {
    setThemeMode(mode => mode === 'dark' ? 'light' : 'dark')
  }, [])

  // VWorld 3D viewer 재초기화 오류 방지용.
  // 시뮬레이션 페이지에 한 번 들어간 뒤에는 컴포넌트를 unmount하지 않고 숨김 처리만 한다.
  const [simulationMounted, setSimulationMounted] = useState(false)

  useEffect(() => {
    if (page !== 'simulation') return

    setSimulationMounted(true)

    // VWorld/Cesium은 display:none 상태였다가 다시 보이면
    // canvas 크기와 렌더 상태가 갱신되지 않는 경우가 있어 강제로 복구 이벤트를 보낸다.
    const fireActivate = () => {
      window.dispatchEvent(new CustomEvent('traffic-sync:simulation-activate'))
    }

    const t1 = setTimeout(fireActivate, 80)
    const t2 = setTimeout(fireActivate, 450)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [page])

  // 여러 화면이 공유하는 데이터 상태
  const [wsData, setWsData] = useState([])
  const { wsStatus, lastUpdate } = useWebSocket(setWsData)
  const [mapCenter, setMapCenter] = useState(null)             // 지도 초기 중심 좌표
  const [selectedGu, setSelectedGu] = useState(() => GU_LIST.find(g => g.name === '강남구'))
  const [stations, setStations] = useState([])                // 메인에서 fetch한 교통량 지점
  // MainDashboard의 handleSelectGu(fetch-area 포함)를 받아두는 ref
  const selectGuRef = useRef(null)
  const [areaFetchState, setAreaFetchState] = useState({ status: 'idle', guName: null, count: 0 })
  const [readyArea, setReadyArea] = useState({ guName: null, count: 0 })
  const [navNotice, setNavNotice] = useState('')
  const [notifQueue, setNotifQueue] = useState([])

  const isLoggedIn = page !== 'login' && page !== 'civil'

  const handleNewComplaint = useCallback((c) => {
    if (isLoggedIn) setNotifQueue(prev => [...prev, c])
  }, [isLoggedIn])
  useComplaintNotification(handleNewComplaint)


  const onDismissNotif = useCallback((id) => {
    setNotifQueue(prev => prev.filter(c => c.id !== id))
  }, [])

  // 로그인 브리핑 카드
  const [loginBriefing, setLoginBriefing] = useState(null) // { name, gu, weatherDesc, temp, pendingCount }

  const showNavNotice = (message) => {
    setNavNotice(message)
    setTimeout(() => setNavNotice(''), 2500)
  }

  const isSimulationAreaReady = (gu = selectedGu) =>
    !!gu && readyArea.guName === gu.name

  const handleAreaFetchState = (nextState) => {
    setAreaFetchState(nextState)
    if (nextState?.status === 'done') {
      setReadyArea({ guName: nextState.guName, count: nextState.count ?? 0 })
    }
  }

  const enterSimulation = () => {
    if (areaFetchState.status === 'loading') {
      const fetchingGu = areaFetchState.guName
        ? GU_LIST.find(g => g.name === areaFetchState.guName)
        : null
      if (fetchingGu || selectedGu) setMapCenter(fetchingGu || selectedGu)
      setPage('main')
      showNavNotice(`${areaFetchState.guName || '선택 구'} 데이터 수집 중입니다. 완료 후 시뮬레이션을 열 수 있습니다.`)
      return
    }

    if (!isSimulationAreaReady()) {
      if (selectedGu) setMapCenter(selectedGu)
      setPage('main')
      showNavNotice(`${selectedGu?.name || '선택 구'} 데이터 수집이 끝난 뒤 시뮬레이션을 열 수 있습니다.`)
      return
    }

    if (selectedGu) setMapCenter(selectedGu)
    setPage('simulation')
  }

  // AI 어시스턴트 / 브리핑 로직 일체
  const assistant = useAssistant({
    page,
    onNavIntent: (intent) => {
      switch (intent.action) {
        case 'navigate':
          if (intent.page === 'map')             { if (selectedGu) setMapCenter(selectedGu); setPage('map') }
          else if (intent.page === 'simulation') enterSimulation()
          else if (intent.page === 'cctv')       setPage('cctv')
          else if (intent.page === 'news')       setPage('news')
          break
        case 'select_gu': {
          const gu = GU_LIST.find(g => g.name === intent.gu || intent.gu?.includes(g.name))
          // fetch-area 포함된 MainDashboard 핸들러 우선 사용
          if (gu) selectGuRef.current ? selectGuRef.current(gu) : (setSelectedGu(gu), setMapCenter(gu))
          break
        }
        case 'mypage': setPage('mypage'); break
        case 'logout':  setPage('login'); break
      }
    },
  })

  // 구 클릭 → 지도 페이지로 이동 (분석 중이면 차단)
  const goMap = (center) => assistant.tryNav(() => {
    if (center) setMapCenter(center)
    setPage('map')
  })
  const goSimulation = () => assistant.tryNav(enterSimulation)

  // SVG 지도에서 구 선택 → 선택 상태 갱신 + 브리핑 시작 확인 팝업
  const handleSelectGu = (gu) => {
    if (assistant.isAnalyzing) { assistant.blockNav(); return }
    setSelectedGu(gu)
    setMapCenter(gu)
    const name = JSON.parse(localStorage.getItem('ts_user') || '{}').name || '관제사'
    assistant.promptGuBriefing(name, gu.name)
  }

  // ── 로그인/민원 사용자 페이지는 별도 진입 화면 ──────────────────

  if (page === 'civil') return <CivilApp onBack={() => setPage('login')} />

  if (page === 'login') return (
    <LoginPage
      onCivil={() => setPage('civil')}
      onLoginSuccess={async (data) => {
        const name = data.name || '관제사'
        const gu   = selectedGu?.name || '강남구'
        const API  = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/+$/, '')

        setThemeMode('dark')
        setPage(data.isTempPw ? 'mypage' : 'main')

        // 임시 비번이면 브리핑 없이 마이페이지로
        if (data.isTempPw) { assistant.greetOnLogin(name, gu); return }

        // 날씨 + 민원 미처리 건수 병렬 fetch
        let weatherDesc = '정보 없음', temp = '--', pendingCount = 0
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(
              p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
              reject, { timeout: 5000 }
            )
          )
          const [wRes, cRes] = await Promise.all([
            fetch(`${API}/api/civil/auth/weather?lat=${pos.lat}&lng=${pos.lng}`),
            fetch(`${API}/api/complaints`),
          ])
          if (wRes.ok) {
            const w = await wRes.json()
            weatherDesc = w.description || '정보 없음'
            temp = w.temperatureC != null ? `${Math.round(w.temperatureC)}도` : '--'
          }
          if (cRes.ok) {
            const complaints = await cRes.json()
            pendingCount = Array.isArray(complaints)
              ? complaints.filter(c => c.status === '접수').length
              : 0
          }
        } catch {}

        setLoginBriefing({ name, gu, weatherDesc, temp, pendingCount })
      }}
    />
  )

  // ── 로그인 이후 화면 ────────────────────────────────────────────
  // SimulationDashboard는 한 번 생성되면 계속 유지된다.
  // 다른 페이지로 이동할 때는 display:none으로만 숨겨 VWorld viewer 재정의 오류를 막는다.

  const showMain = page === 'main'
    || !['map', 'cctv', 'news', 'simulation', 'mypage', 'complaints'].includes(page)

  // 민원 관리 페이지에서는 전역 AI 챗봇 플로팅 버튼/패널을 숨긴다.
  const showAssistantOverlay = page !== 'complaints'

  // ── 메인 대시보드 + AI 어시스턴트 팝업들 ────────────────────────
  return (
    <>
      {simulationMounted && (
        <div
          style={{
            display: page === 'simulation' ? 'block' : 'none',
            height: '100vh',
            width: '100vw',
            overflow: 'hidden',
          }}
        >
          <SimulationDashboard
            onGoMain={() => setPage('main')}
            onGoMap={goMap}
            onGoNews={() => setPage('news')}
            onGoCctv={() => setPage('cctv')}
            onGoComplaints={() => setPage('complaints')}
            onGoMyPage={() => setPage('mypage')}
            onLogout={() => setPage('login')}
            selectedGu={selectedGu}
            isMuted={assistant.isMuted}
            onToggleMute={assistant.toggleMute}
            isMicActive={assistant.voiceUI.active && !assistant.voiceMinimized}
            onToggleMic={assistant.onFloatingClick}
            notifQueue={notifQueue}
            onDismissNotif={onDismissNotif}
            wsData={wsData}
            themeMode={themeMode}
            onToggleTheme={toggleThemeMode}
          />
        </div>
      )}


      {page === 'news' && (
        <NewsDashboard
          onGoMain={() => setPage('main')}
          onGoMap={goMap}
          onGoCctv={() => setPage('cctv')}
          onGoSimulation={goSimulation}
          onGoComplaints={() => setPage('complaints')}
          onGoMyPage={() => setPage('mypage')}
          onLogout={() => setPage('login')}
          selectedGu={null}
          notifQueue={notifQueue}
          onDismissNotif={onDismissNotif}
          themeMode={themeMode}
          onToggleTheme={toggleThemeMode}
        />
      )}

      {page === 'cctv' && (
        <CctvDashboard
          onGoMain={() => setPage('main')}
          onGoMap={goMap}
          onGoNews={() => setPage('news')}
          onGoSimulation={goSimulation}
          onGoComplaints={() => setPage('complaints')}
          onGoMyPage={() => setPage('mypage')}
          onLogout={() => setPage('login')}
          selectedGu={null}
          notifQueue={notifQueue}
          onDismissNotif={onDismissNotif}
          themeMode={themeMode}
          onToggleTheme={toggleThemeMode}
        />
      )}

      {page === 'map' && (
        <MapDashboard
          onGoMain={() => setPage('main')}
          onGoCctv={() => setPage('cctv')}
          onGoNews={() => setPage('news')}
          onGoSimulation={goSimulation}
          onGoComplaints={() => setPage('complaints')}
          onGoMyPage={() => setPage('mypage')}
          onLogout={() => setPage('login')}
          selectedGu={selectedGu}
          wsData={wsData}
          setWsData={setWsData}
          initialCenter={mapCenter}
          wsStatus={wsStatus}
          lastUpdate={lastUpdate}
          stations={stations}
          isMuted={assistant.isMuted}
          onToggleMute={assistant.toggleMute}
          isMicActive={assistant.voiceUI.active && !assistant.voiceMinimized}
          onToggleMic={assistant.onFloatingClick}
          notifQueue={notifQueue}
          onDismissNotif={onDismissNotif}
          themeMode={themeMode}
          onToggleTheme={toggleThemeMode}
        />
      )}
      {page === 'mypage' && (
        <MyPage onBack={() => setPage('main')} />
      )}

      {page === 'complaints' && (
        <ComplaintManagePage
          onGoMain={() => setPage('main')}
          onGoMap={goMap}
          onGoNews={() => setPage('news')}
          onGoCctv={() => setPage('cctv')}
          onGoSimulation={goSimulation}
          onGoComplaints={() => setPage('complaints')}
          onGoMyPage={() => setPage('mypage')}
          onLogout={() => setPage('login')}
          headerSelectedGu={selectedGu}
          onBack={() => setPage('map')}
          notifQueue={notifQueue}
          onDismissNotif={onDismissNotif}
          themeMode={themeMode}
          onToggleTheme={toggleThemeMode}
        />
      )}

      <NavBlockToast message={assistant.navBlockMsg || navNotice} />

      {showMain && (
        <ComplaintNotificationBanner
          queue={notifQueue}
          onDismiss={onDismissNotif}
          isMuted={assistant.isMuted}
          popupOpen={!!assistant.pendingBriefing}
        />
      )}

      {/* 음성 어시스턴트 채팅 팝업 (최소화 상태가 아닐 때만) */}
      {showMain && showAssistantOverlay && assistant.voiceUI.active && !assistant.voiceMinimized && (
        <VoiceAssistantPanel
          voiceUI={assistant.voiceUI}
          voiceSTTActive={assistant.voiceSTTActive}
          msgEndRef={assistant.msgEndRef}
          onStartSTT={assistant.startVoiceSTT}
          onStopTTS={assistant.stopAllTTS}
          onMinimize={assistant.minimizeVoiceUI}
          onClose={assistant.closeVoiceUI}
          onEmailConfirm={assistant.handleEmailConfirmClick}
        />
      )}


      {showMain && (
        <MainDashboard
          onGoMap={goMap}
          onGoCctv={() => assistant.tryNav(() => setPage('cctv'))}
          onGoNews={() => assistant.tryNav(() => setPage('news'))}
          onGoSimulation={goSimulation}
          onGoComplaints={() => assistant.tryNav(() => setPage('complaints'))}
          onGoMyPage={() => assistant.tryNav(() => setPage('mypage'))}
          onLogout={() => assistant.tryNav(() => setPage('login'))}
          wsData={wsData}
          setWsData={setWsData}
          stations={stations}
          setStations={setStations}
          selectedGu={selectedGu}
          onSelectGu={handleSelectGu}
          onAreaFetchState={handleAreaFetchState}
          onRegisterSelectGu={(fn) => { selectGuRef.current = fn }}
          isMuted={assistant.isMuted}
          onToggleMute={assistant.toggleMute}
          isMicActive={assistant.voiceUI.active && !assistant.voiceMinimized}
          onToggleMic={assistant.onFloatingClick}
          notifQueue={notifQueue}
          onDismissNotif={onDismissNotif}
          themeMode={themeMode}
          onToggleTheme={toggleThemeMode}
        />
      )}

      {/* 로그인 브리핑 카드 */}
      {loginBriefing && (
        <LoginBriefingCard
          briefing={loginBriefing}
          onClose={() => setLoginBriefing(null)}
          onTTSDone={() => {
            const { name, gu } = loginBriefing
            setLoginBriefing(null)
            assistant.activatePendingBriefing(name, gu)
          }}
        />
      )}

      {/* AI 플로팅 버튼 */}
      {showMain && showAssistantOverlay && (
        <AIFloatingButton
          active={assistant.voiceUI.active}
          minimized={assistant.voiceMinimized}
          onClick={assistant.onFloatingClick}
        />
      )}

      {/* 구 분석 시작 확인 팝업 */}
      {showMain && showAssistantOverlay && (
        <PendingBriefingPopup
          pending={assistant.pendingBriefing}
          onStart={assistant.acceptPendingBriefing}
          onDismiss={assistant.dismissPendingBriefing}
          shifted={assistant.voiceUI.active && !assistant.voiceMinimized}
        />
      )}
    </>
  )
}
