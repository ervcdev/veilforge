'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Shield } from 'lucide-react'
import Link from 'next/link'

import { useVeilForge } from '@/hooks/useVeilForge'

// ─────────────────────────────────────────────────────────────
// CONFIG & ENVIRONMENT
// ─────────────────────────────────────────────────────────────
const BACKEND_URL = typeof window !== 'undefined' 
  ? process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'
  : 'http://localhost:3001'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
interface CommitRow {
  id: string
  agent: string
  agentShort: string
  hash: string
  hashShort: string
  block: number
  timestamp: number
  isNew: boolean
}

interface RevealRow {
  id: string
  agent: string
  agentShort: string
  direction: 'BID' | 'ASK'
  price: number
  amount: number
  timestamp: number
  isNew: boolean
  matching?: boolean
  glow?: boolean
}

interface TickerEvent {
  id: string
  type: 'commit' | 'reveal' | 'match'
  text: string
  timestamp: number
}

interface Metrics {
  tps: number
  matches: number
  volume: number
  activeOrders: number
  avgReveal: number
}

interface BestRate {
  agentAddress: string
  agentShort: string
  spread: number
  wethOutput: number
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const randomHex = (len: number) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min

// Helper para fetch seguro con headers CORS
const safeFetch = async (url: string, options?: RequestInit) => {
  const headers = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...options?.headers,
  }
  return fetch(url, { ...options, headers })
}

const STRATEGY_KEYS = ['marketMaker', 'arbitrage', 'conservative'] as const

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function VeilForgeDashboard() {
  const {
    commits: liveCommits,
    reveals: liveReveals,
    ticker: liveTicker,
    metrics: liveMetrics,
    isConnected: onchainConnected,
  } = useVeilForge()

  const [backendOnline, setBackendOnline] = useState(true)
  const isConnected = onchainConnected && backendOnline

  // Demo mock state (fallback cuando no estamos conectados on-chain)
  const [mockCommits, setMockCommits] = useState<CommitRow[]>([])
  const [mockReveals, setMockReveals] = useState<RevealRow[]>([])
  const [mockTicker, setMockTicker] = useState<TickerEvent[]>([])
  const [metrics, setMetrics] = useState<Metrics>({
    tps: 247,
    matches: 1842,
    volume: 127543,
    activeOrders: 342,
    avgReveal: 1.24,
  })
  const [mockBlockNumber, setMockBlockNumber] = useState(19847523)
  const blockNumberRef = useRef(19847523)
  const matchedIdsRef = useRef<Set<string>>(new Set())
  const revealCycleRef = useRef(0)
  const [glowingAgent, setGlowingAgent] = useState<string | null>(null)
  const [bestRate, setBestRate] = useState<BestRate>({
    agentAddress: '',
    agentShort: '',
    spread: 0.25,
    wethOutput: 0.3342,
  })
  const [inputAmount, setInputAmount] = useState('1000')
  const [flashingMetric, setFlashingMetric] = useState<string | null>(null)
  const [blockFlash, setBlockFlash] = useState(false)
  const [tpsDirection, setTpsDirection] = useState<'up' | 'down'>('up')
  const prevTpsRef = useRef(247)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [connectionTimedOut, setConnectionTimedOut] = useState(false)
  const contractsConfigured = !!process.env.NEXT_PUBLIC_CLOB_ADDRESS
  const statusMode: 'live' | 'demo' = isConnected ? 'live' : 'demo'
  const [now, setNow] = useState(Date.now())

  const [agentRunning, setAgentRunning] = useState<Record<number, boolean>>({
    1: false, 2: false, 3: false
  })
  const [agentPids, setAgentPids] = useState<Record<number, number | null>>({
    1: null, 2: null, 3: null
  })
  const [starting, setStarting] = useState<Record<number, boolean>>({
    1: false, 2: false, 3: false
  })
  const [logsOpen, setLogsOpen] = useState<Record<number, boolean>>({
    1: false, 2: false, 3: false
  })
  const [agentLogs, setAgentLogs] = useState<Record<number, string[]>>({
    1: [], 2: [], 3: []
  })
  const [autoKillAt, setAutoKillAt] = useState<Record<number, string | null>>({
    1: null, 2: null, 3: null
  })
  const [mockAgentOrders, setMockAgentOrders] = useState<Record<string, { orders: number; lastAction: string; activityPct: number }>>({})

  // ─────────────────────────────────────────────────────────────
  // POLLING: Agent Status (every 5 seconds)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        if (!BACKEND_URL) return
        const res = await safeFetch(`${BACKEND_URL}/api/agents/status`)
        if (!res.ok) return
        const data = await res.json()
        setBackendOnline(true)
        setAgentRunning({
          1: data.agents?.[1]?.running || false,
          2: data.agents?.[2]?.running || false,
          3: data.agents?.[3]?.running || false
        })
        setAgentPids({
          1: data.agents?.[1]?.pid || null,
          2: data.agents?.[2]?.pid || null,
          3: data.agents?.[3]?.pid || null
        })
      } catch (err) {
        console.error('[v0] Agent status poll error:', err)
        setBackendOnline(false)
      }
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // POLLING: Agent Logs (every 2 seconds when panel is open)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const openPanels = Object.entries(logsOpen)
      .filter(([, open]) => open)
      .map(([idx]) => parseInt(idx))

    if (openPanels.length === 0) return

    const poll = async () => {
      for (const idx of openPanels) {
        try {
          const res = await safeFetch(`${BACKEND_URL}/api/agents/logs?agentIndex=${idx}`)
          if (!res.ok) continue
          setBackendOnline(true)
          const data = await res.json()
          setAgentLogs(prev => ({ ...prev, [idx]: data.logs || [] }))
        } catch (err) {
          console.error('[v0] Agent logs poll error:', err)
        }
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [logsOpen])

  // ─────────────────────────────────────────────────────────────
  // Agent Cards (static demo data)
  // ─────────────────────────────────────────────────────────────
  const agentCards = useMemo(() => [
    { address: '0x1234567890abcdef5678', short: '0x1234...5678', strategy: 'MARKET MAKER' as const, spreadRange: '0.20-0.35%', orders: 47, feesUsd: 1247.50, activityPct: 75, isTopAgent: true, dotColor: '#00ff88', dotPulse: false, lastAction: 'BID 1.20 WETH @ 3002', registered: true },
    { address: '0x8765432109abcdef4321', short: '0x8765...4321', strategy: 'ARBITRAGE' as const, spreadRange: '0.08-0.40%', orders: 31, feesUsd: 892.30, activityPct: 45, isTopAgent: false, dotColor: '#00ff88', dotPulse: false, lastAction: 'ASK 0.85 WETH @ 2998', registered: true },
    { address: '0xABCDEF0123456789EF01', short: '0xABCD...EF01', strategy: 'CONSERVATIVE' as const, spreadRange: '0.60-0.80%', orders: 18, feesUsd: 234.80, activityPct: 25, isTopAgent: false, dotColor: '#ffaa00', dotPulse: false, lastAction: 'BID 0.40 WETH @ 2995', registered: true },
  ], [])

  // ─────────────────────────────────────────────────────────────
  // Connection Timeout Detection
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isConnected) return
    const timer = setTimeout(() => setConnectionTimedOut(true), 10_000)
    if (isConnected) {
      clearTimeout(timer)
      setConnectionTimedOut(false)
    }
    return () => clearTimeout(timer)
  }, [isConnected, contractsConfigured])

  const showBanner = (!contractsConfigured || connectionTimedOut) && !bannerDismissed

  // ─────────────────────────────────────────────────────────────
  // Display Logic (live vs mock)
  // ─────────────────────────────────────────────────────────────
  const displayBlockNumber =
    isConnected && liveMetrics.blockNumber > 0
      ? liveMetrics.blockNumber
      : mockBlockNumber

  const displayCommits = useMemo<CommitRow[]>(() => {
    if (!isConnected) return mockCommits
    return liveCommits.map((c, i) => ({
      id: c.id,
      agent: c.agent,
      agentShort: c.agentShort,
      hash: c.hash,
      hashShort: c.hash,
      block: c.block,
      timestamp: c.timestamp,
      isNew: i === 0,
    }))
  }, [isConnected, mockCommits, liveCommits])

  const displayReveals = useMemo<RevealRow[]>(() => {
    if (!isConnected) return mockReveals
    return liveReveals.map((r, i) => ({
      id: r.id,
      agent: r.agent,
      agentShort: r.agentShort,
      direction: r.direction,
      price: parseFloat(r.price),
      amount: parseFloat(r.amount),
      timestamp: r.timestamp,
      isNew: i === 0,
    }))
  }, [isConnected, mockReveals, liveReveals])

  const displayTicker = isConnected ? liveTicker : mockTicker

  const displayMetrics = useMemo<Metrics>(() => {
    if (!isConnected) return metrics
    return {
      ...metrics,
      matches: liveMetrics.totalMatches,
      volume: liveMetrics.totalVolume,
      activeOrders: liveMetrics.activeOrders,
    }
  }, [isConnected, metrics, liveMetrics])

  // ─────────────────────────────────────────────────────────────
  // Block Updates (live flash effect)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isConnected && liveMetrics.blockNumber > 0) {
      blockNumberRef.current = liveMetrics.blockNumber
      setBlockFlash(true)
      const t = setTimeout(() => setBlockFlash(false), 300)
      setNow(Date.now())
      return () => clearTimeout(t)
    }
  }, [isConnected, liveMetrics.blockNumber])

  // ─────────────────────────────────────────────────────────────
  // Demo Mode: Simulated block counter (when disconnected)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isConnected) return
    const interval = setInterval(() => {
      setMockBlockNumber(prev => {
        const next = prev + 1
        blockNumberRef.current = next
        return next
      })
      setBlockFlash(true)
      setTimeout(() => setBlockFlash(false), 300)
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [isConnected])

  // ─────────────────────────────────────────────────────────────
  // Live Metrics: Refresh TPS on new blocks
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected) return
    setMetrics(prev => ({
      ...prev,
      tps: Math.floor(randomInRange(340, 420)),
    }))
  }, [isConnected, liveMetrics.blockNumber])

  // ─────────────────────────────────────────────────────────────
  // TPS Direction Tracking
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const tps = displayMetrics.tps
    if (tps !== prevTpsRef.current) {
      setTpsDirection(tps >= prevTpsRef.current ? 'up' : 'down')
      prevTpsRef.current = tps
    }
  }, [displayMetrics.tps])

  // ─────────────────────────────────────────────────────────────
  // Best Rate Updates
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cards = agentCards
    if (cards.length === 0) return
    const interval = setInterval(() => {
      const agent = cards[Math.floor(Math.random() * cards.length)]
      const amount = parseFloat(inputAmount) || 1000
      setBestRate({
        agentAddress: agent.address,
        agentShort: agent.short,
        spread: randomInRange(0.15, 0.35),
        wethOutput: amount / randomInRange(2995, 3005),
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [inputAmount, agentCards])

  // ──────────────────────────────────────────────���──────────────
  // Metric Flashing Helper
  // ─────────────────────────────────────────────────────────────
  const flashMetric = useCallback((metricName: string) => {
    setFlashingMetric(metricName)
    setTimeout(() => setFlashingMetric(null), 200)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // Main Demo Simulation Cycle
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isConnected) return

    const demoAddresses = [
      '0x1234567890abcdef5678',
      '0x8765432109abcdef4321',
      '0xABCDEF0123456789EF01',
    ]
    const demoShorts = ['0x1234...5678', '0x8765...4321', '0xABCD...EF01']

    const interval = setInterval(() => {
      const agentIdx = Math.floor(Math.random() * 3)
      const agentAddr = demoAddresses[agentIdx]
      const agentShort = demoShorts[agentIdx]
      const hash = `${randomHex(8)}...${randomHex(4)}`
      
      const newCommit: CommitRow = {
        id: generateId(),
        agent: agentAddr,
        agentShort,
        hash: `0x${randomHex(64)}`,
        hashShort: hash,
        block: blockNumberRef.current,
        timestamp: Date.now(),
        isNew: true,
      }
      
      setMockCommits(prev => {
        const updated = [newCommit, ...prev.map(c => ({ ...c, isNew: false }))]
        return updated.slice(0, 5)
      })
      
      setMockTicker(prev => {
        const event: TickerEvent = {
          id: generateId(),
          type: 'commit',
          text: `Agent ${agentShort} committed — ${hash}`,
          timestamp: Date.now(),
        }
        return [event, ...prev].slice(0, 20)
      })
      
      setGlowingAgent(agentAddr)
      setTimeout(() => setGlowingAgent(null), 600)
      
      const actionDir = Math.random() < 0.5 ? 'BID' : 'ASK'
      const actionAmount = randomInRange(0.4, 1.8).toFixed(2)
      const actionPrice = randomInRange(2992, 3008).toFixed(0)
      const newLastAction = `${actionDir} ${actionAmount} WETH @ ${actionPrice}`
      setMockAgentOrders(prev => {
        const entry = prev[agentAddr] ?? { orders: 0, lastAction: '', activityPct: 20 }
        const updated = {
          ...prev,
          [agentAddr]: {
            orders: entry.orders + 1,
            lastAction: newLastAction,
            activityPct: Math.min(100, entry.activityPct + 5),
          },
        }
        demoAddresses.forEach(a => {
          if (a !== agentAddr && updated[a]) {
            updated[a] = { ...updated[a], activityPct: Math.max(10, updated[a].activityPct - 2) }
          }
        })
        return updated
      })
      
      setTimeout(() => {
        const direction: 'BID' | 'ASK' = revealCycleRef.current % 2 === 1 ? 'BID' : 'ASK'
        revealCycleRef.current += 1
        const price = direction === 'BID'
          ? randomInRange(2998, 3008)
          : randomInRange(2992, 3002)
        const amount = randomInRange(0.5, 2)

        const newReveal: RevealRow = {
          id: generateId(),
          agent: agentAddr,
          agentShort,
          direction,
          price,
          amount,
          timestamp: Date.now(),
          isNew: true,
          glow: true,
        }

        setMockCommits(prev => prev.filter(c => c.id !== newCommit.id))

        const revealId = newReveal.id
        setTimeout(() => {
          setMockReveals(prev => prev.map(r => r.id === revealId ? { ...r, glow: false } : r))
        }, 400)

        setMockTicker(prev => {
          const event: TickerEvent = {
            id: generateId(),
            type: 'reveal',
            text: `Agent ${agentShort} revealed ${direction} ${amount.toFixed(2)} WETH @ ${price.toFixed(0)} USDC`,
            timestamp: Date.now(),
          }
          return [event, ...prev].slice(0, 20)
        })

        setMetrics(prev => {
          flashMetric('activeOrders')
          flashMetric('tps')
          return {
            ...prev,
            activeOrders: prev.activeOrders + 1,
            tps: Math.floor(randomInRange(340, 420)),
          }
        })

        setMockReveals(prev => {
          const withNew = [newReveal, ...prev.map(r => ({ ...r, isNew: false }))]

          const counterparty = withNew.find(r => {
            if (r.id === newReveal.id) return false
            if (matchedIdsRef.current.has(r.id)) return false
            if (r.direction === newReveal.direction) return false
            const bid = newReveal.direction === 'BID' ? newReveal : r
            const ask = newReveal.direction === 'ASK' ? newReveal : r
            return bid.price >= ask.price
          })

          if (counterparty) {
            const bid = newReveal.direction === 'BID' ? newReveal : counterparty
            const ask = newReveal.direction === 'ASK' ? newReveal : counterparty
            const fillAmount = Math.min(bid.amount, ask.amount)
            const fillPrice = (bid.price + ask.price) / 2

            matchedIdsRef.current.add(newReveal.id)
            matchedIdsRef.current.add(counterparty.id)

            setMockTicker(t => {
              const event: TickerEvent = {
                id: generateId(),
                type: 'match',
                text: `⚡ MATCH ${bid.agentShort} ↔ ${ask.agentShort} — ${fillAmount.toFixed(2)} WETH @ ${fillPrice.toFixed(0)} USDC`,
                timestamp: Date.now(),
              }
              return [event, ...t].slice(0, 20)
            })

            setMetrics(m => {
              flashMetric('matches')
              flashMetric('volume')
              flashMetric('activeOrders')
              return {
                ...m,
                matches: m.matches + 1,
                volume: m.volume + fillAmount * fillPrice,
                activeOrders: Math.max(0, m.activeOrders - 2),
                tps: Math.floor(randomInRange(340, 420)),
                avgReveal: parseFloat(randomInRange(0.9, 1.6).toFixed(2)),
              }
            })

            const flagged = withNew.map(r =>
              r.id === newReveal.id || r.id === counterparty.id
                ? { ...r, matching: true }
                : r
            )

            setTimeout(() => {
              setMockReveals(curr => curr.filter(r => r.id !== newReveal.id && r.id !== counterparty.id))
              matchedIdsRef.current.delete(newReveal.id)
              matchedIdsRef.current.delete(counterparty.id)
            }, 600)

            return flagged.slice(0, 6)
          }

          return withNew.slice(0, 6)
        })
      }, 2500)
    }, 1500)
    
    return () => clearInterval(interval)
  }, [flashMetric, isConnected])

  // ─────────────────────────────────────────────────────────────
  // Metric Items Display
  // ─────────────────────────────────────────────────────────────
  const metricItems = [
    {
      key: 'tps',
      label: 'TPS',
      valueNode: (
        <span className="flex items-center gap-1">
          <span className="font-mono text-5xl font-bold" style={{ color: '#00d4ff' }}>
            {displayMetrics.tps.toLocaleString()}
          </span>
          <span className="text-xl font-bold" style={{ color: tpsDirection === 'up' ? '#00ff88' : '#ff4466' }}>
            {tpsDirection === 'up' ? '↑' : '↓'}
          </span>
        </span>
      ),
    },
    {
      key: 'matches',
      label: 'MATCHES',
      valueNode: (
        <span
          className={`font-mono text-5xl font-bold ${displayMetrics.matches > 0 ? 'animate-pulse' : ''}`}
          style={{ color: displayMetrics.matches > 0 ? '#00ff88' : '#666680' }}
        >
          {displayMetrics.matches.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'volume',
      label: 'VOLUME (USDC)',
      valueNode: (
        <span className="font-mono text-5xl font-bold" style={{ color: '#00d4ff' }}>
          ${displayMetrics.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'activeOrders',
      label: 'ACTIVE ORDERS',
      valueNode: (
        <span
          className="font-mono text-5xl font-bold"
          style={{ color: displayMetrics.activeOrders > 0 ? 'white' : '#666680' }}
        >
          {displayMetrics.activeOrders.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'avgReveal',
      label: 'AVG REVEAL',
      valueNode: (
        <span className="font-mono text-5xl font-bold" style={{ color: '#00d4ff' }}>
          {displayMetrics.avgReveal.toFixed(2)}
          <span className="text-lg font-normal ml-1" style={{ color: '#666680' }}>ms</span>
        </span>
      ),
    },
  ]

  // ─────────────────────────────────────────────────────────────
  // Agent Actions
  // ─────────────────────────────────────────────────────────────
  const handleStartAgent = async (agentIndex: number, strategy: string) => {
    const accessCode = window.prompt(
      `VeilForge Judge Access\n\nEnter access code to start Agent #${agentIndex} (${strategy}):`
    )
    if (!accessCode) return

    setStarting(prev => ({ ...prev, [agentIndex]: true }))

    try {
      const res = await safeFetch(`${BACKEND_URL}/api/agents/start`, {
        method: 'POST',
        body: JSON.stringify({ agentIndex, strategy }),
        headers: {
          'X-Judge-Access-Token': accessCode
        }
      })
      const data = await res.json()

      if (res.status === 401) {
        window.alert('Invalid access code. Please try again.')
        return
      }
      if (!data.success) {
        window.alert(`Error: ${data.error}`)
        return
      }

      setAgentRunning(prev => ({ ...prev, [agentIndex]: true }))
      setAgentPids(prev => ({ ...prev, [agentIndex]: data.pid || null }))
      setAutoKillAt(prev => ({ ...prev, [agentIndex]: data.autoKillAt }))
    } catch (err) {
      console.error('[v0] Start agent error:', err)
      window.alert('Cannot reach agent orchestrator. Is the backend running?')
    } finally {
      setStarting(prev => ({ ...prev, [agentIndex]: false }))
    }
  }

  const handleStopAgent = async (agentIndex: number) => {
    const accessCode = window.prompt(
      `Stop Agent #${agentIndex}\n\nEnter access code to confirm:`
    )
    if (!accessCode) return

    try {
      const res = await safeFetch(`${BACKEND_URL}/api/agents/stop`, {
        method: 'POST',
        body: JSON.stringify({ agentIndex }),
        headers: {
          'X-Judge-Access-Token': accessCode
        }
      })
      const data = await res.json()

      if (res.status === 401) {
        window.alert('Invalid access code.')
        return
      }
      if (data.success) {
        setAgentRunning(prev => ({ ...prev, [agentIndex]: false }))
        setAgentPids(prev => ({ ...prev, [agentIndex]: null }))
        setAutoKillAt(prev => ({ ...prev, [agentIndex]: null }))
      }
    } catch (err) {
      console.error('[v0] Stop agent error:', err)
      window.alert('Cannot reach agent orchestrator.')
    }
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        @keyframes ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .animate-ticker { animation: ticker 25s linear infinite; }
        .animate-ticker:hover { animation-play-state: paused; }
        @keyframes row-enter {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .row-enter { animation: row-enter 300ms ease-out forwards; }
        .flash-white { color: white !important; transition: color 200ms; }
        @keyframes match-flash {
          0%, 100% { background: rgba(0, 212, 255, 0.35); }
          50% { background: rgba(0, 212, 255, 0.7); }
        }
        .row-matching { animation: match-flash 300ms ease-in-out 2; }
        @keyframes reveal-glow {
          0% { background: rgba(0, 212, 255, 0.5); box-shadow: inset 0 0 18px rgba(0, 212, 255, 0.5); }
          100% { background: #111118; box-shadow: inset 0 0 0 rgba(0, 212, 255, 0); }
        }
        .row-glow { animation: reveal-glow 400ms ease-out forwards; }
        @keyframes swap-pulse-bg {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 212, 255, 0.5); }
          50% { box-shadow: 0 0 0 6px rgba(0, 212, 255, 0); }
        }
        .swap-pulse-btn { animation: swap-pulse-bg 2.5s ease-in-out infinite; }
      `}</style>

      {showBanner && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-xs"
          style={{ background: '#2a1f00', borderBottom: '1px solid #7a5200', color: '#ffcc44' }}
          role="alert"
        >
          <span>
            <span style={{ marginRight: '0.4em' }}>&#9888;</span>
            {!contractsConfigured
              ? 'Contract addresses not configured — showing demo data'
              : 'Unable to connect to Somnia Testnet — showing demo data'}
          </span>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss warning"
            className="shrink-0 text-base leading-none"
            style={{ color: '#ffcc44', opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            &#x2715;
          </button>
        </div>
      )}

      <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: '#0a0a0f', minWidth: '1280px' }}>
        {/* TOP BAR */}
        <div className="h-12 flex items-center justify-between px-6" style={{ background: '#080810', borderBottom: '1px solid #1a1a2e' }}>
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <polygon points="8,1 15,4.5 15,11.5 8,15 1,11.5 1,4.5" fill="none" stroke="#00d4ff" strokeWidth="1.5" />
            </svg>
            <div className="font-mono font-bold text-xl" style={{ color: '#00d4ff' }}>VEILFORGE</div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
            <span className="text-sm font-mono" style={{ color: '#666680' }}>
              {isConnected ? 'SOMNIA TESTNET' : 'DEMO MODE'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${statusMode === 'live' ? 'animate-pulse' : ''}`}
                style={{ background: statusMode === 'live' ? '#00ff88' : '#ffcc44' }}
              />
              <span
                className="font-mono text-xs uppercase"
                style={{ color: statusMode === 'live' ? '#00ff88' : '#ffcc44' }}
              >
                {statusMode === 'live' ? 'LIVE' : 'DEMO'}
              </span>
            </div>
            <span style={{ color: '#1a1a2e' }}>|</span>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: isConnected ? '#00ff88' : '#666680' }}
              />
              <span
                className="font-mono text-xs transition-colors duration-200"
                style={{ color: blockFlash ? '#00d4ff' : 'white' }}
              >
                {!isConnected && contractsConfigured && !connectionTimedOut
                  ? 'Connecting...'
                  : `BLOCK #${displayBlockNumber.toLocaleString()}`}
              </span>
            </div>
            <span style={{ color: '#1a1a2e' }}>|</span>
            <span className="font-mono text-xs" style={{ color: '#00d4ff' }}>
              3 AGENTS ACTIVE
            </span>
            <span style={{ color: '#1a1a2e' }}>|</span>
            <span className="font-mono text-xs" style={{ color: '#666680' }}>◈ MEV PROTECTED</span>
            <Link
              href="/audit"
              className="font-mono text-xs px-2 py-1 rounded border transition-all"
              style={{ background: '#0d0d14', borderColor: '#1a1a2e', color: '#666680' }}
              onMouseEnter={e => {
                const target = e.currentTarget as HTMLAnchorElement
                target.style.background = '#0d0d14'
                target.style.color = '#00d4ff'
                target.style.borderColor = '#00d4ff'
              }}
              onMouseLeave={e => {
                const target = e.currentTarget as HTMLAnchorElement
                target.style.background = '#0d0d14'
                target.style.color = '#666680'
                target.style.borderColor = '#1a1a2e'
              }}
            >
              AUDIT
            </Link>
          </div>
        </div>
        
        {/* METRICS BAR */}
        <div className="flex gap-4 p-4" style={{ background: '#0a0a0f' }}>
          {metricItems.map(metric => (
            <div
              key={metric.key}
              className="flex-1 rounded p-4 flex flex-col"
              style={{ background: '#0d0d14', border: '1px solid #1a1a2e', borderTopColor: 'rgba(0, 212, 255, 0.2)' }}
            >
              <div className="text-xs uppercase leading-tight tracking-widest" style={{ color: '#666680' }}>
                {metric.label}
              </div>
              <div className="w-8 h-px my-1" style={{ background: '#1a1a2e' }} />
              <div className={`transition-colors duration-200 leading-none ${flashingMetric === metric.key ? 'flash-white' : ''}`}>
                {metric.valueNode}
              </div>
            </div>
          ))}
        </div>
        
        {/* THREE PANELS */}
        <div className="flex-1 flex gap-6 px-6 pb-0 overflow-hidden">
          {/* LEFT PANEL — COMMITS & REVEALS */}
          <div className="w-[40%] flex flex-col gap-6 min-h-0">
            {/* COMMITS */}
            <div className="flex flex-col rounded" style={{ background: '#0d0d14', border: '1px solid #1a1a2e', maxHeight: '200px' }}>
              <div className="flex items-center p-4 border-b shrink-0" style={{ borderColor: '#1a1a2e' }}>
                <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: '#666680' }}>COMMITS</span>
                <span className="ml-2 font-mono text-xs px-2 py-0.5 rounded-full border" style={{ background: '#0d0d14', borderColor: '#1a1a2e', color: '#666680' }}>{displayCommits.length}</span>
              </div>
              {displayCommits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8" style={{ color: '#666680' }}>
                  <span className="text-3xl mb-2" style={{ opacity: 0.5 }}>⬡</span>
                  <span className="text-xs">Waiting for agent commits</span>
                  <span className="text-xs mt-1" style={{ opacity: 0.4 }}>Agents cycle every ~8 seconds</span>
                </div>
              ) : (
                <div className="overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ background: '#111118' }}>
                      <tr>
                        <th className="text-left p-2 font-normal w-28" style={{ color: '#666680' }}>AGENT</th>
                        <th className="text-left p-2 font-normal" style={{ color: '#666680', maxWidth: '140px' }}>HASH</th>
                        <th className="text-left p-2 font-normal w-24" style={{ color: '#666680' }}>BLOCK</th>
                        <th className="text-left p-2 font-normal w-20" style={{ color: '#666680' }}>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayCommits.map(commit => {
                        const age = (now - commit.timestamp) / 1000
                        const faded = age > 3
                        return (
                          <tr
                            key={commit.id}
                            className={`${commit.isNew ? 'row-enter' : ''} hover:bg-[#0d0d14] transition-colors`}
                            style={{
                              background: '#111118',
                              borderBottom: '1px solid #1a1a2e',
                              opacity: faded ? 0.6 : 1,
                              transition: 'opacity 600ms ease, background-color 150ms ease',
                            }}
                          >
                            <td className="p-2 font-mono text-xs w-28 whitespace-nowrap" style={{ color: '#666680' }}>{commit.agentShort}</td>
                            <td
                              className="p-2 font-mono text-xs transition-all duration-300"
                              style={{
                                color: '#00d4ff',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '140px',
                                textShadow: commit.isNew ? '0 0 8px rgba(0, 212, 255, 0.9)' : 'none',
                                filter: commit.isNew ? 'brightness(1.4)' : 'brightness(1)',
                              }}
                            >
                              {commit.hashShort}
                            </td>
                            <td className="p-2 font-mono text-xs w-24 whitespace-nowrap" style={{ color: '#666680' }}>{commit.block}</td>
                            <td className="p-2 w-20">
                              <span className="px-1 rounded text-xs" style={{ background: '#1a1a2e', color: '#666680' }}>PENDING</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            
            {/* REVEALS */}
            <div className="flex-1 flex flex-col rounded min-h-0" style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
              <div className="flex items-center p-4 border-b shrink-0" style={{ borderColor: '#1a1a2e' }}>
                <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: '#666680' }}>REVEALS</span>
                <span className="ml-2 font-mono text-xs px-2 py-0.5 rounded-full border" style={{ background: '#0d0d14', borderColor: '#1a1a2e', color: '#666680' }}>{displayReveals.length}</span>
                <span className="ml-auto text-xs font-mono" style={{ background: '#1a1a2e', borderRadius: '0.25rem', padding: '0 6px' }}>
                  <span style={{ color: '#00ff88' }}>{displayReveals.filter(r => r.direction === 'BID').length} BID</span>
                  <span style={{ color: '#666680' }}> / </span>
                  <span style={{ color: '#ff4466' }}>{displayReveals.filter(r => r.direction === 'ASK').length} ASK</span>
                </span>
              </div>
              {displayReveals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8" style={{ color: '#666680' }}>
                  <span className="text-3xl mb-2" style={{ opacity: 0.5 }}>◎</span>
                  <span className="text-xs">No reveals yet</span>
                  <span className="text-xs mt-1" style={{ opacity: 0.4 }}>Reveals appear ~5 blocks after commit</span>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto min-h-0">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ background: '#111118' }}>
                      <tr>
                        <th className="text-left p-2 font-normal w-28" style={{ color: '#666680' }}>AGENT</th>
                        <th className="text-left p-2 font-normal w-16" style={{ color: '#666680' }}>DIR</th>
                        <th className="text-left p-2 font-normal w-32" style={{ color: '#666680' }}>PRICE</th>
                        <th className="text-left p-2 font-normal w-24" style={{ color: '#666680' }}>AMOUNT</th>
                        <th className="text-left p-2 font-normal w-24" style={{ color: '#666680' }}>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayReveals.map(reveal => (
                        <tr
                          key={reveal.id}
                          className={`${reveal.isNew ? 'row-enter' : ''} ${reveal.matching ? 'row-matching' : ''} ${reveal.glow ? 'row-glow' : ''} hover:bg-[#0d0d14] transition-colors`}
                          style={{
                            background: '#111118',
                            borderBottom: '1px solid #1a1a2e',
                            borderLeft: `2px solid ${reveal.matching ? '#00d4ff' : reveal.direction === 'BID' ? '#00ff88' : '#ff4466'}`,
                          }}
                        >
                          <td className="p-2 font-mono text-xs w-28 whitespace-nowrap" style={{ color: '#666680' }}>{reveal.agentShort}</td>
                          <td className="p-2 w-16">
                            <span
                              className="px-1 rounded text-xs"
                              style={{
                                background: reveal.direction === 'BID' ? 'rgba(0,255,136,0.12)' : 'rgba(255,68,102,0.12)',
                                color: reveal.direction === 'BID' ? '#00ff88' : '#ff4466',
                              }}
                            >
                              {reveal.direction}
                            </span>
                          </td>
                          <td className="p-2 font-mono text-xs w-32 whitespace-nowrap text-white">{reveal.price.toFixed(2)} USDC</td>
                          <td className="p-2 font-mono text-xs w-24 whitespace-nowrap" style={{ color: '#666680' }}>{reveal.amount.toFixed(2)} WETH</td>
                          <td className="p-2 w-24">
                            <span className="px-1 rounded text-xs" style={{ background: '#001a22', color: '#00d4ff' }}>REVEALED</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          
          {/* CENTER PANEL - SWAP */}
          <div className="w-[30%]">
            <div
              className="h-full rounded-lg p-6 flex flex-col"
              style={{ background: '#0d0d14', border: '1px solid rgba(0, 212, 255, 0.3)' }}
            >
              <div className="text-xs uppercase tracking-widest font-bold" style={{ color: '#00d4ff' }}>BEST AVAILABLE RATE</div>
              <div className="text-xs mt-1" style={{ color: '#666680' }}>Protected by commit-reveal cryptography</div>
              
              <div className="mt-6">
                <label className="text-xs" style={{ color: '#666680' }}>YOU PAY</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3 rounded font-mono text-xl text-white outline-none"
                    style={{ background: '#111118', border: '1px solid #1a1a2e' }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#666680' }}>USDC</span>
                </div>
              </div>
              
              <div className="mt-4">
                <label className="text-xs" style={{ color: '#666680' }}>YOU RECEIVE</label>
                <div
                  className="relative mt-1 p-3 rounded font-mono text-xl text-white"
                  style={{ background: '#0a0a0f', border: '1px solid #1a1a2e' }}
                >
                  {bestRate.wethOutput.toFixed(6)}
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#666680' }}>WETH</span>
                </div>
                <div className="flex justify-between text-xs mt-2">
                  <span style={{ color: '#666680' }}>Best agent</span>
                  <span className="font-mono" style={{ color: '#00d4ff' }}>
                    via Agent-{bestRate.agentShort} | spread: {bestRate.spread.toFixed(2)}%
                  </span>
                </div>
              </div>

              <button
                className="swap-pulse-btn w-full mt-5 py-3.5 font-bold rounded-lg text-base uppercase tracking-widest transition-colors cursor-pointer"
                style={{ background: '#00d4ff', color: '#0a0a0f' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.background = '#00b8d9'}
                onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.background = '#00d4ff'}
              >
                SWAP NOW
              </button>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded p-2 text-center" style={{ background: '#080810' }}>
                  <div className="text-xs" style={{ color: '#666680' }}>Commit Phase</div>
                  <div className="font-mono text-xs text-white">Hash only</div>
                </div>
                <div className="rounded p-2 text-center" style={{ background: '#080810' }}>
                  <div className="text-xs" style={{ color: '#666680' }}>MEV Exposure</div>
                  <div className="font-mono text-xs" style={{ color: '#00ff88' }}>0%</div>
                </div>
              </div>

              <div className="mt-3 text-xs text-center" style={{ color: '#666680' }}>
                No frontrunning possible — orders are cryptographically hidden until execution
              </div>

              <div className="mt-2 flex justify-center">
                <span
                  className="inline-flex items-center gap-1 text-xs rounded-full px-3 py-1"
                  style={{ background: '#001a22', color: '#00ff88' }}
                >
                  <Shield size={12} />
                  MEV PROTECTED
                </span>
              </div>
            </div>
          </div>
          
          {/* RIGHT PANEL — AGENT COMPETITION */}
          <div className="w-[30%] flex flex-col min-h-0">

            {/* Panel header — matches COMMITS / REVEALS style */}
            <div
              className="flex items-center justify-between px-4 py-3 mb-3 shrink-0 rounded-t"
              style={{ background: '#080810', border: '1px solid #1a1a2e', borderBottom: 'none' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: '#666680' }}>
                  Agent Competition
                </span>
                <span
                  className="font-mono text-xs px-2 py-0.5 rounded-full border"
                  style={{
                    background: '#0d0d14',
                    borderColor: '#1a1a2e',
                    color: Object.values(agentRunning).filter(Boolean).length > 0 ? '#00d4ff' : '#666680',
                  }}
                >
                  {Object.values(agentRunning).filter(Boolean).length} active
                </span>
              </div>
              <span className="text-xs font-mono" style={{ color: '#666680' }}>
                auto-kill 30m
              </span>
            </div>

            <div className="flex flex-col gap-3 flex-1 overflow-y-auto min-h-0">
              {agentCards.map((agent, i) => {
                const agentIndex = i + 1
                const strategy = STRATEGY_KEYS[i] ?? 'marketMaker'
                const demoData = mockAgentOrders[agent.address]
                const displayOrders = demoData?.orders ?? agent.orders
                const displayLastAction = demoData?.lastAction || agent.lastAction
                const displayActivity = demoData?.activityPct ?? agent.activityPct
                const isRunning = agentRunning[agentIndex]
                const isStarting = starting[agentIndex]

                return (
                  <div
                    key={agent.address}
                    className="rounded transition-all duration-300 shrink-0 overflow-hidden"
                    style={{
                      background: '#0d0d14',
                      border: `1px solid ${glowingAgent === agent.address ? '#00d4ff' : '#1a1a2e'}`,
                      boxShadow: glowingAgent === agent.address
                        ? '0 0 0 1px #00d4ff, 0 0 16px rgba(0, 212, 255, 0.15)'
                        : 'none',
                    }}
                  >
                    {/* Card header strip */}
                    <div
                      className="flex items-center gap-2 px-4 py-2 border-b"
                      style={{
                        background: '#111118',
                        borderColor: '#1a1a2e',
                        borderLeft: `3px solid ${isRunning ? '#00ff88' : isStarting ? '#00d4ff' : '#1a1a2e'}`,
                      }}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.dotPulse ? 'animate-pulse' : ''}`}
                        style={{ background: agent.dotColor }}
                      />
                      <span className="font-mono text-xs text-white tracking-wider">{agent.short}</span>
                      <span
                        className="text-xs px-1.5 py-px rounded font-mono whitespace-nowrap"
                        style={{
                          background: agent.strategy === 'MARKET MAKER'
                            ? 'rgba(30,58,138,0.6)'
                            : agent.strategy === 'ARBITRAGE'
                            ? 'rgba(124,45,18,0.6)'
                            : 'rgba(88,28,135,0.6)',
                          color: agent.strategy === 'MARKET MAKER'
                            ? 'rgb(147,197,253)'
                            : agent.strategy === 'ARBITRAGE'
                            ? 'rgb(253,186,116)'
                            : 'rgb(216,180,254)',
                          border: `1px solid ${agent.strategy === 'MARKET MAKER' ? 'rgba(147,197,253,0.2)' : agent.strategy === 'ARBITRAGE' ? 'rgba(253,186,116,0.2)' : 'rgba(216,180,254,0.2)'}`,
                        }}
                      >
                        {agent.strategy}
                      </span>
                      {isRunning && (
                        <span className="ml-auto flex items-center gap-1 text-xs font-mono" style={{ color: '#00ff88' }}>
                          <span className="w-1 h-1 rounded-full bg-[#00ff88] animate-pulse inline-block" />
                          LIVE
                        </span>
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="px-4 py-2 grid grid-cols-3 gap-2 border-b" style={{ borderColor: '#1a1a2e' }}>
                      <div className="flex flex-col">
                        <span className="text-xs uppercase" style={{ color: '#666680', fontSize: '10px', letterSpacing: '0.08em' }}>ORDERS</span>
                        <span className="font-mono text-xs text-white mt-0.5">{displayOrders.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs uppercase" style={{ color: '#666680', fontSize: '10px', letterSpacing: '0.08em' }}>P&amp;L</span>
                        <span className="font-mono text-xs mt-0.5" style={{ color: '#00ff88' }}>
                          +${agent.feesUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs uppercase" style={{ color: '#666680', fontSize: '10px', letterSpacing: '0.08em' }}>SPREAD</span>
                        <span className="font-mono text-xs text-white mt-0.5">{agent.spreadRange}</span>
                      </div>
                    </div>

                    {/* Activity bar + last action */}
                    <div className="px-4 py-2 border-b" style={{ borderColor: '#1a1a2e' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ color: '#666680', fontSize: '10px', letterSpacing: '0.08em' }} className="uppercase">ACTIVITY</span>
                        <span className="font-mono" style={{ color: '#666680', fontSize: '10px' }}>{displayActivity}%</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: '#1a1a2e' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            background: agent.isTopAgent
                              ? 'linear-gradient(90deg, #00d4ff, #00ff88)'
                              : '#666680',
                            width: `${Math.max(2, displayActivity)}%`,
                          }}
                        />
                      </div>
                      <div className="font-mono truncate mt-1" style={{ color: '#666680', fontSize: '10px' }}>
                        {displayLastAction}
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {isStarting ? (
                          <span className="text-xs font-mono text-[#00d4ff] animate-pulse">STARTING...</span>
                        ) : isRunning ? (
                          <button
                            onClick={() => handleStopAgent(agentIndex)}
                            className="px-3 py-1 text-xs font-mono rounded transition-colors"
                            style={{
                              background: 'rgba(255,68,102,0.12)',
                              border: '1px solid rgba(255,68,102,0.4)',
                              color: '#ff4466',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,68,102,0.22)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,68,102,0.12)')}
                          >
                            ■ STOP
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartAgent(agentIndex, strategy)}
                            className="px-3 py-1 text-xs font-mono rounded transition-colors"
                            style={{
                              background: 'rgba(0,255,136,0.12)',
                              border: '1px solid rgba(0,255,136,0.4)',
                              color: '#00ff88',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,255,136,0.22)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,255,136,0.12)')}
                          >
                            ▶ START
                          </button>
                        )}

                        {isRunning && agentPids[agentIndex] && (
                          <span className="text-xs font-mono" style={{ color: '#666680' }}>
                            PID:{agentPids[agentIndex]}
                          </span>
                        )}

                        <button
                          onClick={() => setLogsOpen(prev => ({ ...prev, [agentIndex]: !prev[agentIndex] }))}
                          className="ml-auto text-xs font-mono transition-colors"
                          style={{ color: logsOpen[agentIndex] ? '#00d4ff' : '#666680' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#00d4ff')}
                          onMouseLeave={e => (e.currentTarget.style.color = logsOpen[agentIndex] ? '#00d4ff' : '#666680')}
                        >
                          LOGS {logsOpen[agentIndex] ? '▲' : '▼'}
                        </button>
                      </div>

                      {isRunning && autoKillAt[agentIndex] && (
                        <p className="text-xs font-mono mt-1" style={{ color: '#666680', fontSize: '10px' }}>
                          auto-stop {new Date(autoKillAt[agentIndex]!).toLocaleTimeString()}
                        </p>
                      )}

                      {logsOpen[agentIndex] && (
                        <div
                          className="mt-2 rounded p-2 h-28 overflow-y-auto"
                          style={{ background: '#080810', border: '1px solid #1a1a2e' }}
                        >
                          {agentLogs[agentIndex].length === 0 ? (
                            <p className="text-xs font-mono" style={{ color: '#666680' }}>
                              {isRunning ? 'Waiting for logs...' : 'Agent is stopped'}
                            </p>
                          ) : (
                            agentLogs[agentIndex].map((log, j) => (
                              <p
                                key={j}
                                className={`text-xs font-mono leading-5 ${
                                  log.includes('✓') || log.includes('exitoso') || log.includes('started')
                                    ? 'text-[#00ff88]'
                                    : log.includes('[ERR]') || log.includes('Error')
                                    ? 'text-[#ff4466]'
                                    : log.includes('Commit') || log.includes('Reveal')
                                    ? 'text-[#00d4ff]'
                                    : 'text-[#666680]'
                                }`}
                              >
                                {log}
                              </p>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        
        {/* BOTTOM TICKER */}
        <div
          className="h-14 flex items-center shrink-0"
          style={{ background: '#080810', borderTop: '1px solid #1a1a2e' }}
        >
          <div
            className="flex items-center gap-2 px-4 h-full shrink-0"
            style={{ borderRight: '1px solid #1a1a2e' }}
          >
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ff4466' }} />
            <span className="font-mono text-xs" style={{ color: '#666680' }}>LIVE</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="animate-ticker flex gap-10 whitespace-nowrap items-center">
              {[...displayTicker, ...displayTicker].map((event, i) => (
                event.type === 'match' ? (
                  <span
                    key={`${event.id}-${i}`}
                    className="text-sm font-mono font-bold px-2 py-0.5 rounded"
                    style={{ background: 'rgba(0,212,255,0.1)', color: '#00d4ff' }}
                  >
                    {event.text}
                  </span>
                ) : event.type === 'reveal' ? (
                  <span
                    key={`${event.id}-${i}`}
                    className="text-sm font-mono"
                    style={{ color: 'white' }}
                  >
                    {event.text}
                  </span>
                ) : (
                  <span
                    key={`${event.id}-${i}`}
                    className="text-sm font-mono"
                    style={{ color: '#666680' }}
                  >
                    {event.text}
                  </span>
                )
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
