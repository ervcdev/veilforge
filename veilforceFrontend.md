# Cursor Prompt — VeilForgeDashboard.tsx Actualización

## CONTEXTO
Estoy integrando un backend Express que controla 3 autonomous AI agents en Somnia. 
Ya tengo el backend creado. Ahora necesito actualizar el frontend para agregar botones START/STOP y logs en tiempo real.

## ARCHIVO A MODIFICAR
`frontend/components/veilforge/VeilForgeDashboard.tsx`

## CAMBIO 1: Fix BigInt Literals

Busca en todo el archivo y reemplaza TODAS estas instancias:

```
0n  →  BigInt(0)
1n  →  BigInt(1)
2n  →  BigInt(2)
agent.slashCount <= 2n  →  Number(agent.slashCount) <= 2
```

Cualquier número terminado en `n` debe ser reemplazado. Usa find-and-replace con regex si es necesario.

---

## CAMBIO 2: Agregar Estado y URL del Backend

Dentro del componente, **justo después de todos los `useState` existentes**, agrega esto:

```typescript
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

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
```

---

## CAMBIO 3: Agregar useEffects para Polling

**Justo después de los `useState` nuevos**, agrega esto:

```typescript
// Status cada 5 segundos
useEffect(() => {
  const poll = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/agents/status`)
      if (!res.ok) return
      const data = await res.json()
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
    } catch { /* backend no disponible */ }
  }
  poll()
  const interval = setInterval(poll, 5000)
  return () => clearInterval(interval)
}, [])

// Logs cada 2 segundos cuando el panel esta abierto
useEffect(() => {
  const openPanels = Object.entries(logsOpen)
    .filter(([, open]) => open)
    .map(([idx]) => parseInt(idx))

  if (openPanels.length === 0) return

  const poll = async () => {
    for (const idx of openPanels) {
      try {
        const res  = await fetch(`${BACKEND_URL}/api/agents/logs?agentIndex=${idx}`)
        if (!res.ok) continue
        const data = await res.json()
        setAgentLogs(prev => ({ ...prev, [idx]: data.logs || [] }))
      } catch { /* silencioso */ }
    }
  }

  poll()
  const interval = setInterval(poll, 2000)
  return () => clearInterval(interval)
}, [logsOpen])
```

---

## CAMBIO 4: Agregar Funciones de Control de Agentes

**Antes del `return` del componente**, agrega estas dos funciones:

```typescript
const handleStartAgent = async (agentIndex: number, strategy: string) => {
  const accessCode = window.prompt(
    `VeilForge Judge Access\n\nEnter access code to start Agent #${agentIndex} (${strategy}):`
  )
  if (!accessCode) return

  setStarting(prev => ({ ...prev, [agentIndex]: true }))

  try {
    const res = await fetch(`${BACKEND_URL}/api/agents/start`, {
      method:  'POST',
      headers: {
        'Content-Type':         'application/json',
        'X-Judge-Access-Token': accessCode
      },
      body: JSON.stringify({ agentIndex, strategy })
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
    setAgentPids(prev => ({ ...prev, [agentIndex]: data.pid }))
    setAutoKillAt(prev => ({ ...prev, [agentIndex]: data.autoKillAt }))
  } catch {
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
    const res = await fetch(`${BACKEND_URL}/api/agents/stop`, {
      method:  'POST',
      headers: {
        'Content-Type':         'application/json',
        'X-Judge-Access-Token': accessCode
      },
      body: JSON.stringify({ agentIndex })
    })
    const data = await res.json()

    if (res.status === 401) { window.alert('Invalid access code.'); return }
    if (data.success) {
      setAgentRunning(prev => ({ ...prev, [agentIndex]: false }))
      setAgentPids(prev => ({ ...prev, [agentIndex]: null }))
      setAutoKillAt(prev => ({ ...prev, [agentIndex]: null }))
    }
  } catch {
    window.alert('Cannot reach agent orchestrator.')
  }
}
```

---

## CAMBIO 5: Agregar Controles en Cards de Agentes

En cada card que muestre un agente (donde está `strategy`), **después de todos los stats del agente**, agrega esta sección:

```tsx
<div className="mt-3 pt-3 border-t border-[#1a1a2e]">
  <div className="flex items-center gap-2">
    {starting[agentIndex] ? (
      <span className="text-xs font-mono text-[#666680] animate-pulse">STARTING...</span>
    ) : agentRunning[agentIndex] ? (
      <button
        onClick={() => handleStopAgent(agentIndex)}
        className="px-3 py-1 bg-[#ff4466]/20 border border-[#ff4466]/50
                   text-[#ff4466] text-xs font-mono rounded hover:bg-[#ff4466]/30 transition-colors"
      >
        ■ STOP
      </button>
    ) : (
      <button
        onClick={() => handleStartAgent(agentIndex, strategy)}
        className="px-3 py-1 bg-[#00ff88]/20 border border-[#00ff88]/50
                   text-[#00ff88] text-xs font-mono rounded hover:bg-[#00ff88]/30 transition-colors"
      >
        ▶ START
      </button>
    )}

    <span className={`text-xs font-mono ${agentRunning[agentIndex] ? 'text-[#00ff88]' : 'text-[#666680]'}`}>
      {agentRunning[agentIndex]
        ? `● RUNNING${agentPids[agentIndex] ? ` (PID: ${agentPids[agentIndex]})` : ''}`
        : '○ STOPPED'}
    </span>

    <button
      onClick={() => setLogsOpen(prev => ({ ...prev, [agentIndex]: !prev[agentIndex] }))}
      className="ml-auto text-xs text-[#666680] hover:text-[#00d4ff] transition-colors font-mono"
    >
      LOGS {logsOpen[agentIndex] ? '▲' : '▼'}
    </button>
  </div>

  {agentRunning[agentIndex] && autoKillAt[agentIndex] && (
    <p className="text-xs text-[#666680] font-mono mt-1">
      ⏱ Auto-stop: {new Date(autoKillAt[agentIndex]!).toLocaleTimeString()}
    </p>
  )}

  {logsOpen[agentIndex] && (
    <div className="mt-2 bg-[#080810] border border-[#1a1a2e] rounded p-2 h-32 overflow-y-auto">
      {agentLogs[agentIndex].length === 0 ? (
        <p className="text-[#666680] text-xs font-mono">
          {agentRunning[agentIndex] ? 'Waiting for logs...' : 'Agent is stopped'}
        </p>
      ) : (
        agentLogs[agentIndex].map((log, i) => (
          <p key={i} className={`text-xs font-mono leading-5 ${
            log.includes('✓') || log.includes('exitoso') || log.includes('started')
              ? 'text-[#00ff88]'
              : log.includes('[ERR]') || log.includes('Error')
              ? 'text-[#ff4466]'
              : log.includes('Commit') || log.includes('Reveal')
              ? 'text-[#00d4ff]'
              : 'text-[#666680]'
          }`}>{log}</p>
        ))
      )}
    </div>
  )}
</div>
```

---

## NOTAS IMPORTANTES

1. **BigInt fix es crítico** — si dejas `2n` o `0n`, no compilará
2. **`agentIndex` variable** — debe existir en el scope donde agregas los botones (es el índice del agente: 1, 2 o 3)
3. **`strategy` variable** — debe existir en el scope (la estrategia del agente: marketMaker, arbitrage, conservative)
4. **NEXT_PUBLIC_BACKEND_URL** — agregar a `.env.local` para desarrollo y a Vercel env vars para production
5. El código de acceso es `veilforge2026demo` (configurado en backend .env)

---

## VERIFICACIÓN

Después de aplicar todos los cambios:

```bash
npm run dev

# En el navegador:
# - Los agentes deben mostrarse con ○ STOPPED
# - Click START → prompt de código → ingresa "veilforge2026demo"
# - Debe cambiar a ● RUNNING (PID: XXXX)
# - Click LOGS → panel desplegable muestra logs en tiempo real
# - Click STOP → se detiene el agente
```