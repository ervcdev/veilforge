#!/bin/bash

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─── Header ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          VeilForge — Demo Day Startup                ║${NC}"
echo -e "${CYAN}║          Somnia Agentathon 2026                      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Check node_modules exist ─────────────────────────────────────────────────
echo -e "${YELLOW}[1/4] Checking dependencies...${NC}"

if [ ! -d "agent/node_modules" ]; then
  echo -e "${YELLOW}      Installing agent dependencies...${NC}"
  cd agent && npm install --silent && cd ..
  echo -e "${GREEN}      ✓ Agent dependencies installed${NC}"
else
  echo -e "${GREEN}      ✓ Agent dependencies OK${NC}"
fi

if [ ! -d "backend/node_modules" ]; then
  echo -e "${YELLOW}      Installing backend dependencies...${NC}"
  cd backend && npm install --silent && cd ..
  echo -e "${GREEN}      ✓ Backend dependencies installed${NC}"
else
  echo -e "${GREEN}      ✓ Backend dependencies OK${NC}"
fi

# ─── Check backend .env ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/4] Checking environment...${NC}"

if [ ! -f "backend/.env" ]; then
  echo -e "${RED}      ✗ backend/.env not found!${NC}"
  echo -e "${RED}        Copy backend/.env.example to backend/.env and fill in the values${NC}"
  exit 1
fi

if [ ! -f "agent/.env" ]; then
  echo -e "${RED}      ✗ agent/.env not found!${NC}"
  echo -e "${RED}        Copy agent/.env.example to agent/.env and fill in the values${NC}"
  exit 1
fi

echo -e "${GREEN}      ✓ backend/.env found${NC}"
echo -e "${GREEN}      ✓ agent/.env found${NC}"

# ─── Kill previous processes on port 3001 ─────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/4] Checking port 3001...${NC}"

PORT_PID=$(lsof -ti:3001)
if [ ! -z "$PORT_PID" ]; then
  echo -e "${YELLOW}      Port 3001 in use (PID: $PORT_PID) — killing...${NC}"
  kill -9 $PORT_PID 2>/dev/null
  sleep 1
  echo -e "${GREEN}      ✓ Port 3001 cleared${NC}"
else
  echo -e "${GREEN}      ✓ Port 3001 available${NC}"
fi

# ─── Start the backend ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/4] Starting backend orchestrator...${NC}"

cd backend
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready (max 15 seconds)
echo -e "${YELLOW}      Waiting for backend to be ready...${NC}"
READY=false
for i in {1..15}; do
  sleep 1
  if curl -s http://localhost:3001/ > /dev/null 2>&1; then
    READY=true
    break
  fi
  echo -ne "${YELLOW}      Attempt $i/15...\r${NC}"
done

if [ "$READY" = false ]; then
  echo -e "${RED}      ✗ Backend failed to start after 15 seconds${NC}"
  echo -e "${RED}        Check backend.log for errors:${NC}"
  echo -e "${RED}        cat backend.log${NC}"
  kill $BACKEND_PID 2>/dev/null
  exit 1
fi

echo -e "${GREEN}      ✓ Backend running — PID: $BACKEND_PID${NC}"

# Save PID for the stop script
echo $BACKEND_PID > .demo-backend.pid

# ─── Final result ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              VeilForge Backend Ready!                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}  Backend URL:  http://localhost:3001${NC}"
echo -e "${CYAN}  Health check: http://localhost:3001/${NC}"
echo -e "${CYAN}  Logs:         tail -f backend.log${NC}"
echo ""
echo -e "${YELLOW}  NEXT STEPS:${NC}"
echo ""
echo -e "  1. Open a new terminal and run ngrok:"
echo -e "${CYAN}     ngrok http 3001${NC}"
echo ""
echo -e "  2. Copy the ngrok URL (https://xxxxx.ngrok-free.app)"
echo ""
echo -e "  3. Update NEXT_PUBLIC_BACKEND_URL in Vercel:"
echo -e "${CYAN}     vercel.com → your project → Settings → Env Vars${NC}"
echo ""
echo -e "  4. Redeploy the frontend in Vercel"
echo ""
echo -e "  5. Open the dashboard and use START/STOP buttons"
echo -e "${CYAN}     https://veilforge-frontend.vercel.app${NC}"
echo ""
echo -e "${YELLOW}  To stop everything:${NC}"
echo -e "     ./demo-stop.sh"
echo ""
echo -e "  Backend PID saved to .demo-backend.pid"
echo ""

# Keep the script alive and show real-time logs
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Backend logs (Ctrl+C to exit — backend keeps running)${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo ""
tail -f backend.log
