#!/bin/bash
# Syncro AI Agent 전체 기동 스크립트
# 실행: ./start.sh

set -e
cd "$(dirname "$0")"

echo "==============================="
echo "  Syncro AI Agent 기동 시작"
echo "==============================="

# ── 1. 기존 프로세스 정리 ─────────────────────────────
echo "[1/4] 기존 ollama / uvicorn / ngrok 정리..."
pkill -f "ollama serve" 2>/dev/null || true
pkill -f "agent_server" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true
sleep 2

# ── 2. Ollama 인스턴스 5개 기동 ──────────────────────
echo "[2/4] Ollama 인스턴스 기동..."

# 메인 (qwen2.5:14b) — 포트 11434
OLLAMA_HOST=127.0.0.1:11434 ollama serve > /tmp/ollama_11434.log 2>&1 &
echo "  ▸ 메인 ollama :11434 (qwen2.5:14b)"

# 워커 4개 (exaone3.5:2.4b) — 포트 11435~11438
for PORT in 11435 11436 11437 11438; do
    OLLAMA_HOST=127.0.0.1:$PORT ollama serve > /tmp/ollama_$PORT.log 2>&1 &
    echo "  ▸ 워커 ollama :$PORT (exaone3.5:2.4b)"
done

# 준비될 때까지 대기
echo "  ⏳ Ollama 준비 대기 (15초)..."
sleep 15

# ── 3. FastAPI AI Agent 서버 기동 ────────────────────
echo "[3/4] AI Agent 서버 기동 (포트 8001)..."
/Users/parkheeyoun/traffic-sync-git/ai-env/bin/uvicorn agent_server:app --host 0.0.0.0 --port 8001 > /tmp/agent_server.log 2>&1 &
echo "  ▸ agent_server :8001"
sleep 3

# ── 4. ngrok 터널 기동 ───────────────────────────────
echo "[4/4] ngrok 터널 기동..."
ngrok http --url=subfloor-deploy-unsubtle.ngrok-free.dev 8001 > /tmp/ngrok.log 2>&1 &
echo "  ▸ ngrok → https://subfloor-deploy-unsubtle.ngrok-free.dev"

sleep 2

echo ""
echo "==============================="
echo "  기동 완료!"
echo "==============================="
echo "  메인 ollama   : http://localhost:11434"
echo "  워커 ollama   : http://localhost:11435~11438"
echo "  AI Agent      : http://localhost:8001"
echo "  ngrok 외부 URL: https://subfloor-deploy-unsubtle.ngrok-free.dev"
echo ""
echo "  로그 확인:"
echo "    tail -f /tmp/agent_server.log"
echo "    tail -f /tmp/ngrok.log"
echo "    tail -f /tmp/ollama_11434.log"
echo ""
echo "  종료하려면: ./stop.sh"
