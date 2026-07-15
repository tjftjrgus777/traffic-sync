#!/bin/bash
# 전체 서비스 종료 스크립트
# 실행: bash stop-all.sh
#
# 종료 순서: frontend → Flask 서버들 → ai-agent(agent_server) → Spring Boot

echo "================================================"
echo "  🛑 메타빌드 전체 서비스 종료"
echo "================================================"

# 1. frontend (Vite)
echo "▸ Frontend 종료..."
pkill -f "vite" 2>/dev/null && echo "  ✅ Frontend 종료" || echo "  ℹ️  Frontend 없음"

# 2. Flask 서버들
echo "▸ 교통량 예측 Flask (port 5002) 종료..."
lsof -ti:5002 | xargs kill -15 2>/dev/null && echo "  ✅" || echo "  ℹ️  없음"

echo "▸ 뉴스 Flask (port 5001) 종료..."
lsof -ti:5001 | xargs kill -15 2>/dev/null && echo "  ✅" || echo "  ℹ️  없음"

echo "▸ 민원 분류 Flask (port 8002) 종료..."
lsof -ti:8002 | xargs kill -15 2>/dev/null && echo "  ✅" || echo "  ℹ️  없음"

# 3. ai-agent (agent_server + mcp_server)
echo "▸ ai-agent 종료..."
bash "$(dirname "$0")/ai-agent/stop.sh" 2>/dev/null && echo "  ✅ ai-agent 종료" || echo "  ℹ️  ai-agent 없음"

# 4. Spring Boot (port 8080)
echo "▸ Spring Boot (port 8080) 종료..."
lsof -ti:8080 | xargs kill -15 2>/dev/null && echo "  ✅" || echo "  ℹ️  없음"

# 남은 프로세스 확인
sleep 1
PORTS=(5002 5001 8002 8080)
ALIVE=0
for PORT in "${PORTS[@]}"; do
  if lsof -ti:"$PORT" >/dev/null 2>&1; then
    echo "  ⚠️  port $PORT 아직 살아있음 → 강제 종료"
    lsof -ti:"$PORT" | xargs kill -9 2>/dev/null
    ALIVE=$((ALIVE+1))
  fi
done

echo "================================================"
if [ "$ALIVE" -eq 0 ]; then
  echo "  ✅ 모든 서비스 정상 종료 완료"
else
  echo "  ✅ 종료 완료 ($ALIVE 포트 강제종료)"
fi
echo "================================================"
