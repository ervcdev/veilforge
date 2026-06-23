import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { startAgent, stopAgent, getStatus, getLogs, stopAll } from './agentManager'

dotenv.config()

const app  = express()
const PORT = parseInt(process.env.PORT || '3001')

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = [
  'https://veilforge-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL || ''
].filter(Boolean)

// [FIX ERROR 3] Permite preview URLs de Vercel (.vercel.app)
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app')
    ) {
      callback(null, true)
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`)
      callback(new Error(`CORS: Origin ${origin} not allowed`))
    }
  },
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Judge-Access-Token'],
  credentials:    true
}))

app.use(express.json())

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token    = req.headers['x-judge-access-token'] as string
  const expected = process.env.JUDGE_ACCESS_CODE

  if (!expected) {
    res.status(500).json({ error: 'Server misconfigured — JUDGE_ACCESS_CODE not set' })
    return
  }

  if (!token || token !== expected) {
    console.warn(`[Auth] Unauthorized — token: "${token?.slice(0, 8)}..."`)
    res.status(401).json({ error: 'Unauthorized — invalid judge access code' })
    return
  }

  next()
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (req: Request, res: Response) => {
  const status       = getStatus()
  const runningCount = Object.values(status).filter(a => a.running).length

  res.json({
    service:       'VeilForge Agent Orchestrator',
    version:       '2.0.0',
    network:       'Somnia Testnet — Chain 50312',
    status:        'running',
    uptime:        Math.floor(process.uptime()),
    agentsRunning: runningCount,
    autoKillAfter: `${process.env.AGENT_MAX_RUNTIME_MINUTES || 30} minutes`,
    contracts: {
      clob:     process.env.COMMIT_REVEAL_CLOB_ADDRESS,
      registry: process.env.AGENT_REGISTRY_ADDRESS
    }
  })
})

// ─── GET /api/agents/status ───────────────────────────────────────────────────

app.get('/api/agents/status', (req: Request, res: Response) => {
  try {
    res.json({ success: true, agents: getStatus() })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── GET /api/agents/logs ─────────────────────────────────────────────────────

app.get('/api/agents/logs', (req: Request, res: Response) => {
  try {
    const agentIndex = parseInt(req.query.agentIndex as string)
    if (![1, 2, 3].includes(agentIndex)) {
      res.status(400).json({ success: false, error: 'agentIndex must be 1, 2, or 3' })
      return
    }
    res.json({ success: true, agentIndex, logs: getLogs(agentIndex as 1 | 2 | 3) })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── POST /api/agents/start ───────────────────────────────────────────────────

app.post('/api/agents/start', requireAuth, (req: Request, res: Response) => {
  try {
    const { agentIndex, strategy } = req.body

    if (![1, 2, 3].includes(agentIndex)) {
      res.status(400).json({ success: false, error: 'agentIndex must be 1, 2, or 3' })
      return
    }

    const validStrategies = ['marketMaker', 'arbitrage', 'conservative']
    if (!validStrategies.includes(strategy)) {
      res.status(400).json({
        success: false,
        error:   `strategy must be one of: ${validStrategies.join(', ')}`
      })
      return
    }

    const result = startAgent(agentIndex as 1 | 2 | 3, strategy)
    if (!result.success) {
      res.status(409).json(result)
      return
    }

    const maxMinutes = parseInt(process.env.AGENT_MAX_RUNTIME_MINUTES || '30')
    const autoKillAt = new Date(Date.now() + maxMinutes * 60 * 1000).toISOString()

    res.json({
      success: true,
      pid:     result.pid,
      agentIndex,
      strategy,
      autoKillAt,
      message: `Agent #${agentIndex} started — auto-kill in ${maxMinutes} minutes`
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── POST /api/agents/stop ────────────────────────────────────────────────────

app.post('/api/agents/stop', requireAuth, (req: Request, res: Response) => {
  try {
    const { agentIndex } = req.body
    if (![1, 2, 3].includes(agentIndex)) {
      res.status(400).json({ success: false, error: 'agentIndex must be 1, 2, or 3' })
      return
    }

    const result = stopAgent(agentIndex as 1 | 2 | 3)
    if (!result.success) {
      res.status(404).json(result)
      return
    }

    res.json({
      success:    true,
      agentIndex,
      message:    `Agent #${agentIndex} stopped successfully`
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── Shutdown limpio ──────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM — stopping all agents...')
  stopAll()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[Server] SIGINT — stopping all agents...')
  stopAll()
  process.exit(0)
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     VeilForge Agent Orchestrator v2.0.0              ║
║     Network:   Somnia Testnet (Chain 50312)          ║
║     Port:      ${PORT}                                    ║
║     Auto-kill: ${process.env.AGENT_MAX_RUNTIME_MINUTES || '30'} min per agent               ║
║     Auth:      X-Judge-Access-Token required         ║
╚══════════════════════════════════════════════════════╝
  `)
})