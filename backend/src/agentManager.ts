import { spawn, ChildProcess } from 'child_process'
import path from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentProcess {
  process:   ChildProcess
  strategy:  string
  startedAt: string
  pid:       number
  logs:      string[]
  killTimer: NodeJS.Timeout
}

interface StartResult {
  success: boolean
  pid?:    number
  error?:  string
}

interface StopResult {
  success: boolean
  error?:  string
}

interface AgentStatus {
  running:   boolean
  pid:       number | null
  strategy:  string
  startedAt: string | null
  uptime:    number | null
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const agents = new Map<number, AgentProcess>()
const MAX_LOGS = 100

const STRATEGIES: Record<number, string> = {
  1: 'marketMaker',
  2: 'arbitrage',
  3: 'conservative'
}

function ts(): string {
  return new Date().toISOString()
}

// ─── Start Agent ──────────────────────────────────────────────────────────────

export function startAgent(agentIndex: 1 | 2 | 3, strategy: string): StartResult {
  if (agents.has(agentIndex)) {
    return { success: false, error: `Agent ${agentIndex} is already running` }
  }

  const agentDir = path.join(__dirname, '..', '..', 'agent')

  const agentEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_INDEX:                String(agentIndex),
    AGENT_STRATEGY:             strategy,
    AGENT_1_PRIVATE_KEY:        process.env.PRIVATE_KEY_AGENT_1 || '',
    AGENT_2_PRIVATE_KEY:        process.env.PRIVATE_KEY_AGENT_2 || '',
    AGENT_3_PRIVATE_KEY:        process.env.PRIVATE_KEY_AGENT_3 || '',
    COMMIT_REVEAL_CLOB_ADDRESS: process.env.COMMIT_REVEAL_CLOB_ADDRESS || '',
    AGENT_REGISTRY_ADDRESS:     process.env.AGENT_REGISTRY_ADDRESS     || '',
    TOKEN_A_ADDRESS:            process.env.TOKEN_A_ADDRESS            || '',
    TOKEN_B_ADDRESS:            process.env.TOKEN_B_ADDRESS            || '',
    SOMNIA_RPC_URL:             process.env.SOMNIA_RPC_URL             || '',
    SOMNIA_CHAIN_ID:            process.env.SOMNIA_CHAIN_ID            || '50312',
    REVEAL_WINDOW_BLOCKS:       process.env.REVEAL_WINDOW_BLOCKS       || '5',
    COLLATERAL_AMOUNT:          process.env.COLLATERAL_AMOUNT          || '0.01',
  }

  console.log(`[${ts()}][AgentManager] Starting Agent #${agentIndex} (${strategy})...`)

  // [FIX ERROR 2] Spawn directo a node sin shell intermediario
  // npm run agentX mata solo npm, dejando node como zombie
  // node --require ts-node/register mata el proceso real directamente
  const child = spawn(
    'node',
    ['--require', 'ts-node/register', 'src/index.ts'],
    {
      cwd:      agentDir,
      env:      agentEnv,
      stdio:    ['ignore', 'pipe', 'pipe'],
      shell:    false,   // sin shell — SIGTERM llega directo al proceso node
      detached: false    // muere con el servidor padre
    }
  )

  if (!child.pid) {
    return { success: false, error: 'Failed to spawn agent process' }
  }

  const agentData: AgentProcess = {
    process:   child,
    strategy,
    startedAt: new Date().toISOString(),
    pid:       child.pid,
    logs:      [`[${ts()}] Agent #${agentIndex} started (${strategy}) — PID: ${child.pid}`],
    killTimer: null as any
  }

  // Kill switch automatico
  const maxMinutes = parseInt(process.env.AGENT_MAX_RUNTIME_MINUTES || '30')
  const killTimer = setTimeout(() => {
    console.log(`[${ts()}][AgentManager] Auto-kill Agent #${agentIndex} (${maxMinutes}min limit)`)
    agentData.logs.push(`[${ts()}] AUTO-KILL: reached ${maxMinutes}min limit`)
    stopAgent(agentIndex)
  }, maxMinutes * 60 * 1000)

  agentData.killTimer = killTimer

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean)
    lines.forEach(line => {
      agentData.logs.push(`[${ts()}] ${line}`)
      process.stdout.write(`[Agent${agentIndex}] ${line}\n`)
    })
    if (agentData.logs.length > MAX_LOGS) {
      agentData.logs = agentData.logs.slice(-MAX_LOGS)
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean)
    lines.forEach(line => {
      agentData.logs.push(`[${ts()}] [ERR] ${line}`)
      process.stderr.write(`[Agent${agentIndex}][ERR] ${line}\n`)
    })
    if (agentData.logs.length > MAX_LOGS) {
      agentData.logs = agentData.logs.slice(-MAX_LOGS)
    }
  })

  child.on('exit', (code, signal) => {
    console.log(`[${ts()}][AgentManager] Agent #${agentIndex} exited — code: ${code}, signal: ${signal}`)
    const agent = agents.get(agentIndex)
    if (agent) {
      clearTimeout(agent.killTimer)
      agent.logs.push(`[${ts()}] Agent exited (code: ${code}, signal: ${signal})`)
    }
    agents.delete(agentIndex)
  })

  child.on('error', (err) => {
    console.error(`[${ts()}][AgentManager] Agent #${agentIndex} spawn error:`, err.message)
    agentData.logs.push(`[${ts()}] [ERR] ${err.message}`)
    agents.delete(agentIndex)
  })

  agents.set(agentIndex, agentData)
  console.log(`[${ts()}][AgentManager] Agent #${agentIndex} started — PID: ${child.pid}`)
  return { success: true, pid: child.pid }
}

// ─── Stop Agent ───────────────────────────────────────────────────────────────

export function stopAgent(agentIndex: 1 | 2 | 3): StopResult {
  const agent = agents.get(agentIndex)
  if (!agent) {
    return { success: false, error: `Agent ${agentIndex} is not running` }
  }

  console.log(`[${ts()}][AgentManager] Stopping Agent #${agentIndex} (PID: ${agent.pid})...`)
  clearTimeout(agent.killTimer)

  try {
    agent.process.kill('SIGTERM')
  } catch (err: any) {
    console.error(`[${ts()}] Error sending SIGTERM:`, err.message)
  }

  // Fallback SIGKILL si sigue vivo despues de 5 segundos
  setTimeout(() => {
    if (agents.has(agentIndex)) {
      console.log(`[${ts()}] Force killing Agent #${agentIndex} with SIGKILL...`)
      try {
        process.kill(agent.pid, 'SIGKILL')
      } catch { /* ya murio */ }
      agents.delete(agentIndex)
    }
  }, 5000)

  return { success: true }
}

// ─── Get Status ───────────────────────────────────────────────────────────────

export function getStatus(): Record<number, AgentStatus> {
  const now = Date.now()
  const result: Record<number, AgentStatus> = {}

  for (let i = 1; i <= 3; i++) {
    const agent     = agents.get(i)
    const startedAt = agent?.startedAt || null
    const uptime    = startedAt
      ? Math.floor((now - new Date(startedAt).getTime()) / 1000)
      : null

    result[i] = {
      running:   !!agent,
      pid:       agent?.pid || null,
      strategy:  agent?.strategy || STRATEGIES[i],
      startedAt,
      uptime
    }
  }

  return result
}

// ─── Get Logs ─────────────────────────────────────────────────────────────────

export function getLogs(agentIndex: 1 | 2 | 3): string[] {
  const agent = agents.get(agentIndex)
  if (!agent) return [`[${ts()}] Agent #${agentIndex} is not running`]
  return agent.logs.slice(-50)
}

// ─── Stop All ─────────────────────────────────────────────────────────────────

export function stopAll(): void {
  console.log(`[${ts()}][AgentManager] Stopping all agents...`)
  for (let i = 1; i <= 3; i++) {
    if (agents.has(i)) stopAgent(i as 1 | 2 | 3)
  }
}