#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          VeilForge — Stopping Demo                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Stop the backend by saved PID
if [ -f ".demo-backend.pid" ]; then
  BACKEND_PID=$(cat .demo-backend.pid)
  if kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "  Stopping backend (PID: $BACKEND_PID)..."
    kill $BACKEND_PID
    sleep 2
    echo -e "${GREEN}  ✓ Backend stopped${NC}"
  else
    echo -e "  Backend already stopped"
  fi
  rm .demo-backend.pid
fi

# Clean up any process on port 3001
PORT_PID=$(lsof -ti:3001)
if [ ! -z "$PORT_PID" ]; then
  kill -9 $PORT_PID 2>/dev/null
  echo -e "${GREEN}  ✓ Port 3001 cleared${NC}"
fi

# Clean up logs
if [ -f "backend.log" ]; then
  rm backend.log
  echo -e "${GREEN}  ✓ Logs cleared${NC}"
fi

echo ""
echo -e "${GREEN}  All done. VeilForge demo stopped cleanly.${NC}"
echo ""
