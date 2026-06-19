"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Shield } from 'lucide-react'
import Link from 'next/link'
import { createPublicClient, http } from 'viem'
import { useVeilForge } from '@/hooks/useVeilForge'

// Types
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

interface OnchainAgentStats {
  address: string
  registeredAt: bigint
  slashCount: bigint
  ordersExecuted: bigint
  registered: boolean
  collateral: bigint
  totalVolume: bigint
  feesEarned: bigint
}

// Contracts
const AGENT_REGISTRY_ADDRESS = '0x22b4710F8219949D98849dAdBecF077a1b0Edc75' as const

const REGISTRY_ABI = [
  {
    name: 'getAllAgents',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'registeredAt',   type: 'uint64'  },
        { name: 'slashCount',     type: 'uint64'  },
        { name: 'ordersExecuted', type: 'uint64'  },
        { name: 'registered',     type: 'bool'    },
        { name: 'collateral',     type: 'uint256' },
        { name: 'totalVolume',    type: 'uint256' },
        { name: 'feesEarned',     type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
] as const

const SOMNIA_CHAIN = {
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: { default: { http: ['https://dream-rpc.somnia.network'] } },
} as const

const publicClient = createPublicClient({
  chain: SOMNIA_CHAIN,
  transport: http(),
})

const STRATEGY_LABELS = ['MARKET MAKER', 'ARBITRAGE', 'CONSERVATIVE'] as const
const SPREAD_RANGES = ['0.20-0.35%', '0.08-0.40%', '0.60-0.80%'] as const

// Helpers
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const randomHex = (len: number) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function VeilForgeDashboard() {
  const {
    commits: liveCommits,
    reveals: liveReveals,
    ticker: liveTicker,
    metrics: liveMetrics,
    isConnected,
  } = useVeilForge()

  // Mock state (fallback when isConnected is false)
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

  // ──────────────────────────────────────────────────────────────
  // IMPROVEMENT 1 — Real onchain agent data
  // ──────────────────────────────────────────────────────────────
  const [onchainAgents, setOnchainAgents] = useState<OnchainAgentStats[]>([])
  const prevOrdersRef = useRef<Record<string, bigint>>({})

  const fetchAgentData = useCallback(async () => {
    try {
      const addresses = await publicClient.readContract({
        address: AGENT_REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'getAllAgents',
      }) as string[]

      if (!addresses || addresses.length === 0) return

      const stats = await Promise.all(
        addresses.map(async (addr) => {
          const data = await publicClient.readContract({
            address: AGENT_REGISTRY_ADDRESS,
            abi: REGISTRY_ABI,
            functionName: 'getAgent',
            args: [addr as `0x${string}`],
          }) as {
            registeredAt: bigint
            slashCount: bigint
            ordersExecuted: bigint
            registered: boolean
            collateral: bigint
            totalVolume: bigint
            feesEarned: bigint
          }
          return { address: addr, ...data }
        })
      )

      setOnchainAgents(stats)
    } catch {
      // silently fail — demo data continues showing
    }
  }, [])

  useEffect(() => {
    fetchAgentData()
    const interval = setInterval(fetchAgentData, 10_000)
    return () => clearInterval(interval)
  }, [fetchAgentData])

  // Detect which agents had ordersExecuted increase since last poll
  const [recentlyActiveAgents, setRecentlyActiveAgents] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (onchainAgents.length === 0) return
    const newlyActive = new Set<string>()
    onchainAgents.forEach(agent => {
      const prev = prevOrdersRef.current[agent.address]
      if (prev !== undefined && agent.ordersExecuted > prev) {
        newlyActive.add(agent.address)
      }
      prevOrdersRef.current[agent.address] = agent.ordersExecuted
    })
    if (newlyActive.size > 0) {
      setRecentlyActiveAgents(newlyActive)
      const timer = setTimeout(() => setRecentlyActiveAgents(new Set()), 5000)
      return () => clearTimeout(timer)
    }
  }, [onchainAgents])

  // Build the agent cards: use onchain data when available, fall back to demo
  const agentCards = useMemo(() => {
    if (onchainAgents.length > 0) {
      const maxOrders = Math.max(1, ...onchainAgents.map(a => Number(a.ordersExecuted)))
      return onchainAgents.slice(0, 3).map((agent, i) => {
        const feesUsd = Number(agent.feesEarned) / 1e18
        const orders = Number(agent.ordersExecuted)
        const isTopAgent = orders === maxOrders && orders > 0
        // Determine dot color
        let dotColor = '#ff4466'  // red: not registered or slashed heavily
        let dotPulse = false
        if (agent.registered && agent.slashCount <= 2n) {
          if (recentlyActiveAgents.has(agent.address)) {
            dotColor = '#00ff88'
            dotPulse = true
          } else if (orders > 0) {
            dotColor = '#00ff88'
          } else {
            dotColor = '#ffaa00'
          }
        }

        // Last action: find most recent event matching this agent
        const lastCommit = liveCommits.find(c => c.agent.toLowerCase() === agent.address.toLowerCase())
        const lastReveal = liveReveals.find(r => r.agent.toLowerCase() === agent.address.toLowerCase())
        let lastAction = 'No activity yet'
        if (lastReveal) {
          lastAction = `${lastReveal.direction} ${parseFloat(lastReveal.amount).toFixed(2)} WETH @ ${parseFloat(lastReveal.price).toFixed(0)}`
        } else if (lastCommit) {
          lastAction = `Commit ${lastCommit.hash.slice(0, 10)}...`
        }

        return {
          address: agent.address,
          short: shortenAddress(agent.address),
          strategy: STRATEGY_LABELS[i] ?? 'UNKNOWN',
          spreadRange: SPREAD_RANGES[i] ?? '—',
          orders,
          feesUsd,
          activityPct: maxOrders > 0 ? (orders / maxOrders) * 100 : 0,
          isTopAgent,
          dotColor,
          dotPulse,
          lastAction,
          registered: agent.registered,
        }
      })
    }

    // Demo fallback
    return [
      { address: '0x1234567890abcdef5678', short: '0x1234...5678', strategy: 'MARKET MAKER' as const, spreadRange: '0.20-0.35%', orders: 47, feesUsd: 1247.50, activityPct: 75, isTopAgent: true, dotColor: '#00ff88', dotPulse: false, lastAction: 'BID 1.20 WETH @ 3002', registered: true },
      { address: '0x8765432109abcdef4321', short: '0x8765...4321', strategy: 'ARBITRAGE' as const, spreadRange: '0.08-0.40%', orders: 31, feesUsd: 892.30, activityPct: 45, isTopAgent: false, dotColor: '#00ff88', dotPulse: false, lastAction: 'ASK 0.85 WETH @ 2998', registered: true },
      { address: '0xABCDEF0123456789EF01', short: '0xABCD...EF01', strategy: 'CONSERVATIVE' as const, spreadRange: '0.60-0.80%', orders: 18, feesUsd: 234.80, activityPct: 25, isTopAgent: false, dotColor: '#ffaa00', dotPulse: false, lastAction: 'BID 0.40 WETH @ 2995', registered: true },
    ]
  }, [onchainAgents, recentlyActiveAgents, liveCommits, liveReveals])

  // Mock agent state for demo simulation
  const [mockAgentOrders, setMockAgentOrders] = useState<Record<string, { orders: number; lastAction: string; activityPct: number }>>({})
  // Demo glow (separate from onchain)

  useEffect(() => {
    if (isConnected) return
    const timer = setTimeout(() => setConnectionTimedOut(true), 10_000)
    if (isConnected) {
      clearTimeout(timer)
      setConnectionTimedOut(false)
    }
    return () => clearTimeout(timer)
  }, [isConnected, contractsConfigured])

  const showBanner =
    (!contractsConfigured || connectionTimedOut) && !bannerDismissed

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

  // Live block flash when connected to chain
  useEffect(() => {
    if (isConnected && liveMetrics.blockNumber > 0) {
      blockNumberRef.current = liveMetrics.blockNumber
      setBlockFlash(true)
      const t = setTimeout(() => setBlockFlash(false), 300)
      setNow(Date.now())
      return () => clearTimeout(t)
    }
  }, [isConnected, liveMetrics.blockNumber])

  // Demo mode: simulated block counter
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

  // Live metrics: refresh TPS on new blocks
  useEffect(() => {
    if (!isConnected) return
    setMetrics(prev => ({
      ...prev,
      tps: Math.floor(randomInRange(340, 420)),
    }))
  }, [isConnected, liveMetrics.blockNumber])

  // Track TPS direction since last change
  useEffect(() => {
    const tps = displayMetrics.tps
    if (tps !== prevTpsRef.current) {
      setTpsDirection(tps >= prevTpsRef.current ? 'up' : 'down')
      prevTpsRef.current = tps
    }
  }, [displayMetrics.tps])

  // Best rate update
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

  // Flash metric helper
  const flashMetric = useCallback((metricName: string) => {
    setFlashingMetric(metricName)
    setTimeout(() => setFlashingMetric(null), 200)
  }, [])

  // Main simulation cycle — only when not connected to live contract
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
          text: `Agent ${agentShort} committed · ${hash}`,
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
        // Decay others
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
            text: `${agentShort} revealed ${direction} ${amount.toFixed(2)} WETH @ ${price.toFixed(0)} USDC`,
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
                text: `MATCH ${bid.agentShort} ↔ ${ask.agentShort} — ${fillAmount.toFixed(2)} WETH @ ${fillPrice.toFixed(0)} USDC`,
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

  // ──────────────────────────────────────────────────────────────
  // IMPROVEMENT 2 — Metric display helpers
  // ──────────────────────────────────────────────────────────────
  const metricItems = [
    {
      key: 'tps',
      label: 'TPS',
      valueNode: (
        <span className="flex items-center gap-1">
          <span className="font-mono-jetbrains text-5xl font-bold" style={{ color: '#00d4ff' }}>
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
          className={`font-mono-jetbrains text-5xl font-bold ${displayMetrics.matches > 0 ? 'animate-pulse' : ''}`}
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
        <span className="font-mono-jetbrains text-5xl font-bold" style={{ color: '#00d4ff' }}>
          ${displayMetrics.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'activeOrders',
      label: 'ACTIVE ORDERS',
      valueNode: (
        <span
          className="font-mono-jetbrains text-5xl font-bold"
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
        <span className="font-mono-jetbrains text-5xl font-bold" style={{ color: '#00d4ff' }}>
          {displayMetrics.avgReveal.toFixed(2)}
          <span className="text-lg font-normal ml-1" style={{ color: '#666680' }}>ms</span>
        </span>
      ),
    },
  ]

  return (
    <>
      <style>{`
        .font-mono-jetbrains { font-family: 'JetBrains Mono', monospace; }
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
      `}</style>

      {showBanner && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 font-mono-jetbrains text-xs"
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
        <div className="h-12 flex items-center justify-between px-4" style={{ background: '#080810', borderBottom: '1px solid #1a1a2e' }}>
          <div className="font-mono-jetbrains font-bold text-xl" style={{ color: '#00d4ff' }}>VEILFORGE</div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
            <span className="text-sm" style={{ color: '#666680' }}>
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
                className="font-mono-jetbrains text-xs uppercase"
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
                className="font-mono-jetbrains text-xs transition-colors duration-200"
                style={{ color: blockFlash ? '#00d4ff' : 'white' }}
              >
                {!isConnected && contractsConfigured && !connectionTimedOut
                  ? 'Connecting...'
                  : `BLOCK #${displayBlockNumber.toLocaleString()}`}
              </span>
            </div>
            <span style={{ color: '#1a1a2e' }}>|</span>
            <span className="text-xs" style={{ color: '#00d4ff' }}>
              {onchainAgents.length > 0 ? `${onchainAgents.length} AGENTS ACTIVE` : '3 AGENTS ACTIVE'}
            </span>
            <Link
              href="/audit"
              className="font-mono-jetbrains text-xs px-2 py-1 rounded border transition-colors"
              style={{ background: '#0d0d14', borderColor: '#1a1a2e', color: '#666680' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = '#00d4ff'
                ;(e.currentTarget as HTMLAnchorElement).style.borderColor = '#00d4ff'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = '#666680'
                ;(e.currentTarget as HTMLAnchorElement).style.borderColor = '#1a1a2e'
              }}
            >
              AUDIT
            </Link>
          </div>
        </div>
        
        {/* ── IMPROVEMENT 2 — METRICS BAR ── */}
        <div className="flex gap-3 p-3" style={{ background: '#0a0a0f' }}>
          {metricItems.map(metric => (
            <div
              key={metric.key}
              className="flex-1 rounded p-3 flex flex-col"
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
        <div className="flex-1 flex gap-3 px-3 pb-0 overflow-hidden">
          {/* ── LEFT PANEL — COMMITS & REVEALS ── */}
          <div className="w-[40%] flex flex-col gap-3">

            {/* COMMITS */}
            <div className="flex-1 flex flex-col overflow-hidden rounded" style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
              <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: '#1a1a2e' }}>
                <span className="text-xs uppercase tracking-widest" style={{ color: '#666680' }}>COMMITS</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#1a1a2e', color: '#00d4ff' }}>{displayCommits.length}</span>
              </div>
              <div className="flex-1 overflow-hidden">
                {displayCommits.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8" style={{ color: '#666680' }}>
                    <span className="text-3xl mb-2" style={{ opacity: 0.5 }}>⬡</span>
                    <span className="text-xs">Waiting for agent commits</span>
                    <span className="text-xs mt-1" style={{ opacity: 0.4 }}>Agents cycle every ~8 seconds</span>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#111118' }}>
                        <th className="text-left p-2 font-normal w-28" style={{ color: '#666680' }}>AGENT</th>
                        <th className="text-left p-2 font-normal" style={{ color: '#666680', width: '100%' }}>HASH</th>
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
                            className={commit.isNew ? 'row-enter' : ''}
                            style={{
                              background: '#111118',
                              borderBottom: '1px solid #1a1a2e',
                              opacity: faded ? 0.6 : 1,
                              transition: 'opacity 600ms ease',
                            }}
                          >
                            <td className="p-2 font-mono-jetbrains text-xs w-28" style={{ color: '#666680' }}>{commit.agentShort}</td>
                            <td
                              className="p-2 font-mono-jetbrains text-xs transition-all duration-300 max-w-0"
                              style={{
                                color: '#00d4ff',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textShadow: commit.isNew ? '0 0 8px rgba(0, 212, 255, 0.9)' : 'none',
                                filter: commit.isNew ? 'brightness(1.4)' : 'brightness(1)',
                                width: '100%',
                              }}
                            >
                              {commit.hashShort}
                            </td>
                            <td className="p-2 font-mono-jetbrains text-xs w-24" style={{ color: '#666680' }}>{commit.block}</td>
                            <td className="p-2 w-20">
                              <span className="px-1 rounded text-xs" style={{ background: '#1a1a2e', color: '#666680' }}>PENDING</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            
            {/* REVEALS */}
            <div className="flex-1 flex flex-col overflow-hidden rounded" style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
              <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: '#1a1a2e' }}>
                <span className="text-xs uppercase tracking-widest" style={{ color: '#666680' }}>REVEALS</span>
                <span className="text-xs px-2 py-0.5 rounded font-mono-jetbrains" style={{ background: '#1a1a2e' }}>
                  <span style={{ color: '#00ff88' }}>{displayReveals.filter(r => r.direction === 'BID').length} BID</span>
                  <span style={{ color: '#666680' }}> / </span>
                  <span style={{ color: '#ff4466' }}>{displayReveals.filter(r => r.direction === 'ASK').length} ASK</span>
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                {displayReveals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8" style={{ color: '#666680' }}>
                    <span className="text-3xl mb-2" style={{ opacity: 0.5 }}>◎</span>
                    <span className="text-xs">No reveals yet</span>
                    <span className="text-xs mt-1" style={{ opacity: 0.4 }}>Reveals appear ~5 blocks after commit</span>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: '#111118' }}>
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
                          className={`${reveal.isNew ? 'row-enter' : ''} ${reveal.matching ? 'row-matching' : ''} ${reveal.glow ? 'row-glow' : ''}`}
                          style={{
                            background: '#111118',
                            borderBottom: '1px solid #1a1a2e',
                            borderLeft: `2px solid ${reveal.matching ? '#00d4ff' : reveal.direction === 'BID' ? '#00ff88' : '#ff4466'}`,
                          }}
                        >
                          <td className="p-2 font-mono-jetbrains text-xs w-28" style={{ color: '#666680' }}>{reveal.agentShort}</td>
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
                          <td className="p-2 font-mono-jetbrains text-xs w-32 text-white">{reveal.price.toFixed(2)} USDC</td>
                          <td className="p-2 font-mono-jetbrains text-xs w-24" style={{ color: '#666680' }}>{reveal.amount.toFixed(2)} WETH</td>
                          <td className="p-2 w-24">
                            <span className="px-1 rounded text-xs" style={{ background: '#001a22', color: '#00d4ff' }}>REVEALED</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
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
                    className="w-full p-3 rounded font-mono-jetbrains text-xl text-white outline-none"
                    style={{ background: '#111118', border: '1px solid #1a1a2e' }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#666680' }}>USDC</span>
                </div>
              </div>
              
              <div className="mt-4">
                <label className="text-xs" style={{ color: '#666680' }}>YOU RECEIVE</label>
                <div
                  className="relative mt-1 p-3 rounded font-mono-jetbrains text-xl text-white"
                  style={{ background: '#0a0a0f', border: '1px solid #1a1a2e' }}
                >
                  {bestRate.wethOutput.toFixed(6)}
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#666680' }}>WETH</span>
                </div>
              </div>
              
              <div className="mt-2 font-mono-jetbrains text-xs" style={{ color: '#666680' }}>
                via Agent-{bestRate.agentShort} | spread: {bestRate.spread.toFixed(2)}%
              </div>
              
              <button
                className="w-full mt-4 py-3 font-bold rounded-lg text-sm uppercase tracking-widest transition-colors cursor-pointer"
                style={{ background: '#00d4ff', color: '#0a0a0f' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#00b8d9'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#00d4ff'}
              >
                SWAP NOW
              </button>
              
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
          
          {/* ── RIGHT PANEL — AGENT COMPETITION ── */}
          <div className="w-[30%] flex flex-col">
            <div className="text-xs uppercase tracking-widest mb-3" style={{ color: '#666680' }}>AGENT COMPETITION</div>
            <div className="flex flex-col gap-4 flex-1">
              {agentCards.map(agent => {
                // In demo mode, merge mock simulation data for orders/lastAction/activity
                const demoData = mockAgentOrders[agent.address]
                const displayOrders = onchainAgents.length > 0 ? agent.orders : (demoData?.orders ?? agent.orders)
                const displayLastAction = onchainAgents.length > 0 ? agent.lastAction : (demoData?.lastAction || agent.lastAction)
                const displayActivity = onchainAgents.length > 0 ? agent.activityPct : (demoData?.activityPct ?? agent.activityPct)

                return (
                  <div
                    key={agent.address}
                    className="rounded-lg p-4 transition-shadow duration-300"
                    style={{
                      background: '#0d0d14',
                      border: '1px solid #1a1a2e',
                      boxShadow: glowingAgent === agent.address
                        ? '0 0 0 1px #00d4ff, 0 0 12px rgba(0, 212, 255, 0.2)'
                        : 'none',
                    }}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${agent.dotPulse ? 'animate-pulse' : ''}`}
                        style={{ background: agent.dotColor }}
                      />
                      <span className="font-mono-jetbrains text-xs text-white">{agent.short}</span>
                      <span
                        className="ml-auto text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap"
                        style={{
                          background: agent.strategy === 'MARKET MAKER' ? 'rgb(30,58,138)' : agent.strategy === 'ARBITRAGE' ? 'rgb(124,45,18)' : 'rgb(88,28,135)',
                          color: agent.strategy === 'MARKET MAKER' ? 'rgb(147,197,253)' : agent.strategy === 'ARBITRAGE' ? 'rgb(253,186,116)' : 'rgb(216,180,254)',
                        }}
                      >
                        {agent.strategy}
                      </span>
                    </div>

                    {/* Stats row */}
                    <div className="flex gap-4 mt-2">
                      <div>
                        <span className="text-xs" style={{ color: '#666680' }}>ORDERS</span>
                        <span className="font-mono-jetbrains text-xs text-white ml-1">{displayOrders.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-xs" style={{ color: '#666680' }}>P&amp;L</span>
                        <span className="font-mono-jetbrains text-xs ml-1" style={{ color: '#00ff88' }}>
                          +${(onchainAgents.length > 0 ? agent.feesUsd : agent.feesUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs" style={{ color: '#666680' }}>SPREAD</span>
                        <span className="font-mono-jetbrains text-xs text-white ml-1">{agent.spreadRange}</span>
                      </div>
                    </div>

                    {/* Activity bar */}
                    <div className="mt-2 h-2 rounded-full" style={{ background: '#1a1a2e' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          background: agent.isTopAgent ? '#00d4ff' : '#666680',
                          width: `${Math.max(2, displayActivity)}%`,
                        }}
                      />
                    </div>

                    {/* Last action */}
                    <div className="font-mono-jetbrains text-xs mt-2 truncate" style={{ color: '#666680' }}>
                      LAST ACTION: {displayLastAction}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        
        {/* BOTTOM TICKER */}
        <div
          className="h-11 flex items-center"
          style={{ background: '#080810', borderTop: '1px solid #1a1a2e' }}
        >
          <div
            className="px-4 h-full flex items-center text-xs uppercase font-bold"
            style={{ color: '#00d4ff', borderRight: '1px solid #1a1a2e' }}
          >
            LIVE FEED
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="animate-ticker flex gap-8 whitespace-nowrap">
              {[...displayTicker, ...displayTicker].map((event, i) => (
                event.type === 'match' ? (
                  <span
                    key={`${event.id}-${i}`}
                    className="text-xs px-3 py-0.5 rounded-full font-medium"
                    style={{ background: '#00d4ff', color: '#0a0a0f' }}
                  >
                    {event.text}
                  </span>
                ) : (
                  <span
                    key={`${event.id}-${i}`}
                    className="text-xs"
                    style={{ color: event.type === 'commit' ? '#666680' : 'white' }}
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
