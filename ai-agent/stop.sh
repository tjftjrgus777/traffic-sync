#!/bin/bash
echo "Syncro AI Agent 종료 중..."
pkill -f "ollama serve" 2>/dev/null && echo "  ▸ ollama 종료" || echo "  ▸ ollama 없음"
pkill -f "agent_server" 2>/dev/null && echo "  ▸ agent_server 종료" || echo "  ▸ agent_server 없음"
pkill -f "ngrok" 2>/dev/null && echo "  ▸ ngrok 종료" || echo "  ▸ ngrok 없음"
echo "완료."
