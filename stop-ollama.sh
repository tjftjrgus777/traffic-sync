#!/bin/zsh
# Ollama 전체 종료 스크립트

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "${RED}[STOP ]${NC} Ollama 프로세스 종료 중..."

pkill -f "ollama serve" 2>/dev/null
sleep 1

if pgrep -f "ollama serve" | grep -q .; then
  echo "${RED}[STOP ]${NC} 강제 종료..."
  pkill -9 -f "ollama serve" 2>/dev/null
  sleep 1
fi

if pgrep -f "ollama serve" | grep -q .; then
  echo "${RED}[FAIL ]${NC} 일부 프로세스가 남아있습니다:"
  pgrep -a ollama
else
  echo "${GREEN}[DONE ]${NC} Ollama 전체 종료 완료"
fi
