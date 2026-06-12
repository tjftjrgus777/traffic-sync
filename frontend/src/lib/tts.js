/**
 * Google Cloud TTS — 단일 전역 큐
 * ------------------------------------------------------------------
 * 앱 전체에서 발생하는 모든 음성 발화(speakAsync)를 하나의 Promise 체인에
 * 순서대로 쌓아 재생한다. 덕분에 여러 곳에서 동시에 호출해도 음성이
 * 겹치지 않고 차례대로 나온다.
 *
 * - speakAsync(text, rate) : 큐에 발화를 추가하고, 재생이 끝나면 resolve되는 Promise 반환
 * - stopAllTTS()           : 현재 재생 중인 오디오를 멈추고 대기 중인 큐도 전부 비움
 * - setTTSMuted / isTTSMuted : 음소거 토글
 * - whenTTSIdle()          : 현재 큐가 끝나는 시점을 기다리는 Promise 반환
 *
 * window.__currentBriefingAudio / __stopBriefingAudio 는 박수(clap) 감지 로직이
 * "현재 TTS가 재생 중인지" 판단하고 강제로 멈출 때 사용하는 전역 핸들이다.
 */

const GOOGLE_TTS_KEY = import.meta.env.VITE_GOOGLE_TTS_KEY || ''

// 마크다운 기호 제거 — TTS가 '#', '*', '`' 같은 기호를 읽지 않도록 전처리
export function stripMd(text) {
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .trim()
}

// ── 모듈 내부 상태 ────────────────────────────────────────────────
let _ttsChain = Promise.resolve()  // 발화 순서를 보장하는 Promise 체인
let _currentTTSAudio = null        // 현재 재생 중인 Audio 객체
let _muted = false                 // 음소거 여부

/**
 * 발화를 큐에 추가한다. 이전 발화가 끝난 뒤 재생되며, 재생 완료 시 resolve된다.
 * @param {string} text  읽을 텍스트
 * @param {number} rate  말하기 속도 (1.0 기본, 라벨 등 짧은 문구는 1.4로 빠르게)
 */
export function speakAsync(text, rate = 1.0) {
  if (_muted || !GOOGLE_TTS_KEY || !text) {
    console.log('[TTS] speakAsync skip — muted:', _muted, 'noKey:', !GOOGLE_TTS_KEY, 'noText:', !text)
    return Promise.resolve()
  }
  console.log('[TTS] speakAsync 시작 —', text.slice(0, 40))

  const p = _ttsChain.then(async () => {
    try {
      const res = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text: stripMd(text).slice(0, 4500) },
            voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C', ssmlGender: 'MALE' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
          }),
        }
      )
      const data = await res.json()
      if (!data.audioContent) return

      await new Promise(resolve => {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`)
        _currentTTSAudio = audio
        window.__currentBriefingAudio = audio
        // 박수 감지가 호출하는 강제 중단 핸들 — resolve를 호출해 await를 풀어준다
        window.__stopBriefingAudio = () => {
          audio.pause()
          _currentTTSAudio = null
          window.__currentBriefingAudio = null
          window.__stopBriefingAudio = null
          _ttsChain = Promise.resolve()  // 중단 시 나머지 큐도 버림
          resolve()
        }
        audio.onended = () => { _currentTTSAudio = null; window.__stopBriefingAudio = null; resolve() }
        audio.onerror = resolve
        audio.play()
      })
    } catch { /* TTS 실패는 조용히 무시 */ }
  })

  _ttsChain = p
  return p
}

/**
 * 재생 중인 오디오를 멈추고 대기 큐를 비운다.
 * 현재 발화의 resolve를 호출하므로 await speakAsync(...) 가 즉시 풀린다.
 */
export function stopAllTTS() {
  if (window.__stopBriefingAudio) {
    window.__stopBriefingAudio()
  } else if (_currentTTSAudio) {
    _currentTTSAudio.pause()
    _currentTTSAudio = null
    window.__currentBriefingAudio = null
  }
  _ttsChain = Promise.resolve()
}

/** 음소거 설정. 음소거 시 진행 중인 발화도 즉시 중단한다. */
export function setTTSMuted(muted) {
  _muted = muted
  if (muted) stopAllTTS()
}

export function isTTSMuted() {
  return _muted
}

/** 현재 TTS 큐가 끝나는 시점을 기다리는 Promise (pendingBriefing 등에서 사용). */
export function whenTTSIdle() {
  return _ttsChain
}
