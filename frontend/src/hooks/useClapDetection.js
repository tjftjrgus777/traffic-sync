import { useEffect, useRef } from 'react';

/**
 * 박수 감지 훅
 * - requiredClaps번 박수 (각 간격 clapWindowMs 이내) → onDoubleClap()
 *
 * 감지 원리: 마이크 오디오 RMS가 임계값을 빠르게 초과하면 박수로 판정
 */
export function useClapDetection({
  onDoubleClap,
  enabled = true,
  requiredClaps = 2,
  clapWindowMs = 700,
}) {
  const ctxRef       = useRef(null);
  const streamRef    = useRef(null);
  const frameRef     = useRef(null);
  const clapCount    = useRef(0);
  const clapTimer    = useRef(null);
  const isClapActive = useRef(false);
  const cooldownRef  = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let destroyed = false;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (destroyed) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        await ctx.resume();

        const source   = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.05;
        source.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        // 박수 감지: 절대값(RMS) + 급등량(delta) 동시 조건
        // 박수는 한 프레임에 급격히 올라오는 attack이 있고 음성·소음은 완만하게 올라옴
        const THRESHOLD = 0.22;  // 최소 볼륨
        const DELTA     = 0.15;  // 이전 프레임 대비 최소 급등량 (핵심 필터)

        let prevRms = 0;

        function tick() {
          if (destroyed) return;
          frameRef.current = requestAnimationFrame(tick);

          analyser.getFloatTimeDomainData(buf);

          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          const delta = rms - prevRms;
          prevRms = rms;

          // 절대 볼륨 AND 급등 둘 다 충족할 때만 박수로 판정
          if (rms > THRESHOLD && delta > DELTA && !isClapActive.current && !cooldownRef.current) {
            isClapActive.current = true;
            clapCount.current += 1;

            clearTimeout(clapTimer.current);

            if (clapCount.current >= requiredClaps) {
              clapCount.current = 0;
              clearTimeout(clapTimer.current);
              cooldownRef.current = true;
              setTimeout(() => { cooldownRef.current = false; }, 3000); // 3초 쿨다운
              onDoubleClap?.();
            } else {
              clapTimer.current = setTimeout(() => {
                clapCount.current = 0;
              }, clapWindowMs);
            }
          } else if (rms < THRESHOLD * 0.3) {
            isClapActive.current = false;
          }
        }

        tick();
      } catch (e) {
        console.warn('[ClapDetection] 마이크 접근 실패:', e.message);
      }
    }

    init();

    return () => {
      destroyed = true;
      cancelAnimationFrame(frameRef.current);
      clearTimeout(clapTimer.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close();
    };
  }, [enabled, onDoubleClap, requiredClaps, clapWindowMs]);
}
