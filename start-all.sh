#!/bin/zsh
# TrafficSync 전체 서버 시작 스크립트
# 사용법: ./start-all.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo "${GREEN}[START]${NC} $1"; }
warn() { echo "${YELLOW}[WAIT ]${NC} $1"; }
info() { echo "${CYAN}[INFO ]${NC} $1"; }

# ══════════════════════════════════════════════════════════════
# 1. 기존 Ollama 프로세스 정리 (포트 충돌 방지)
# ══════════════════════════════════════════════════════════════
if pgrep -f "ollama serve" | grep -q .; then
  warn "기존 Ollama 프로세스 정리 중..."
  pkill -f "ollama serve" 2>/dev/null
  sleep 2
fi

# ══════════════════════════════════════════════════════════════
# 2. Ollama 메인 서버 (port 11434) — qwen2.5:14b
# ══════════════════════════════════════════════════════════════
log "Ollama 메인 서버 시작 (port 11434 / qwen2.5:14b)"
OLLAMA_HOST="0.0.0.0:11434" ollama serve &>/tmp/ollama_11434.log &
sleep 3

# ══════════════════════════════════════════════════════════════
# 3. Ollama 워커 × 4 (port 11435~11438) — exaone3.5:2.4b
# ══════════════════════════════════════════════════════════════
for PORT in 11435 11436 11437 11438; do
  log "Ollama 워커 시작 (port $PORT / exaone3.5:2.4b)"
  OLLAMA_HOST="0.0.0.0:$PORT" ollama serve &>/tmp/ollama_$PORT.log &
  sleep 1
done

warn "Ollama 워커 초기화 대기 중 (5초)..."
sleep 5

# 각 워커에 모델 프리로드
info "exaone3.5:2.4b 모델 프리로드 중..."
for PORT in 11435 11436 11437 11438; do
  OLLAMA_HOST="localhost:$PORT" ollama run exaone3.5:2.4b "" &>/dev/null &
done

# ══════════════════════════════════════════════════════════════
# 3. Spring Boot (port 8080)
# ══════════════════════════════════════════════════════════════
log "Spring Boot 시작 (port 8080)"
osascript -e "tell application \"Terminal\"
  do script \"cd '$ROOT/backend' && ./mvnw spring-boot:run 2>&1 | tee /tmp/spring.log\"
end tell"

sleep 2

# ══════════════════════════════════════════════════════════════
# 4. AI 에이전트 서버 (port 8001)
# ══════════════════════════════════════════════════════════════
log "AI 에이전트 서버 시작 (port 8001)"
osascript -e "tell application \"Terminal\"
  do script \"source '$ROOT/ai-env/bin/activate' && cd '$ROOT/ai-agent' && uvicorn agent_server:app --host 0.0.0.0 --port 8001 --reload 2>&1 | tee /tmp/agent.log\"
end tell"

sleep 1

# ══════════════════════════════════════════════════════════════
# 5. 교통량 예측 서버 (port 5002)
# ══════════════════════════════════════════════════════════════
log "교통량 예측 서버 시작 (port 5002)"
osascript -e "tell application \"Terminal\"
  do script \"source '$ROOT/backend/flask_server/venv/bin/activate' && cd '$ROOT/backend/flask_server' && python app.py 2>&1 | tee /tmp/traffic_predict.log\"
end tell"

sleep 1

# ══════════════════════════════════════════════════════════════
# 6. 민원 분류 서버 (port 8002)
# ══════════════════════════════════════════════════════════════
log "민원 분류 서버 시작 (port 8002)"
osascript -e "tell application \"Terminal\"
  do script \"source '$ROOT/backend/civil_flask_server/venv/bin/activate' && cd '$ROOT/backend/civil_flask_server' && python app.py 2>&1 | tee /tmp/civil.log\"
end tell"

sleep 1

# ══════════════════════════════════════════════════════════════
# 7. 뉴스 서버 (port 5001)
# ══════════════════════════════════════════════════════════════
log "뉴스 서버 시작 (port 5001)"
osascript -e "tell application \"Terminal\"
  do script \"source '$ROOT/backend/News_flask_server/venv/bin/activate' && cd '$ROOT/backend/News_flask_server' && python app.py 2>&1 | tee /tmp/news.log\"
end tell"

sleep 1

# ══════════════════════════════════════════════════════════════
# 8. AnythingLLM (port 3001)
# ══════════════════════════════════════════════════════════════
log "AnythingLLM 시작"
open -a "AnythingLLM"

sleep 1

# ══════════════════════════════════════════════════════════════
# 9. React 프론트엔드 (port 5173) — 마지막
# ══════════════════════════════════════════════════════════════
log "React 프론트엔드 시작 (port 5173)"
osascript -e "tell application \"Terminal\"
  do script \"cd '$ROOT/frontend' && npm run dev 2>&1 | tee /tmp/react.log\"
end tell"

# ══════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  서비스                  포트"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  React                  http://localhost:5173"
echo "  Spring Boot            http://localhost:8080"
echo "  AI 에이전트            http://localhost:8001"
echo "  교통량 예측             http://localhost:5002"
echo "  민원 분류              http://localhost:8002"
echo "  뉴스 서버              http://localhost:5001"
echo "  AnythingLLM            http://localhost:3001"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ollama 메인            http://localhost:11434  (qwen2.5:14b)"
echo "  Ollama 워커 1          http://localhost:11435  (exaone3.5:2.4b)"
echo "  Ollama 워커 2          http://localhost:11436  (exaone3.5:2.4b)"
echo "  Ollama 워커 3          http://localhost:11437  (exaone3.5:2.4b)"
echo "  Ollama 워커 4          http://localhost:11438  (exaone3.5:2.4b)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  로그: /tmp/*.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
