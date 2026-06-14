import path from 'path'
import * as dotenv from 'dotenv'
import {
  createAgentClients,
  setupAgent,
  commitOrder,
  waitForRevealWindow,
  revealOrder,
  sleep
} from './commitReveal'
import { getNextOrderParams }     from './strategies/marketMaker'
import { getArbitrageParams }     from './strategies/arbitrage'
import { getConservativeParams }  from './strategies/conservative'

dotenv.config({ path: path.resolve(__dirname, '../.env') })
// ─── Corrected Config (Wallet Autodetection by Strategy) ────────────────

const STRATEGY = process.env.AGENT_STRATEGY || 'marketMaker'

// Automatically maps each strategy to its corresponding key
let AGENT_INDEX = 1
if (STRATEGY === 'arbitrage') AGENT_INDEX = 2
if (STRATEGY === 'conservative') AGENT_INDEX = 3

const PRIVATE_KEYS: Record<number, `0x${string}`> = {
  1: process.env.AGENT_1_PRIVATE_KEY as `0x${string}`,
  2: process.env.AGENT_2_PRIVATE_KEY as `0x${string}`,
  3: process.env.AGENT_3_PRIVATE_KEY as `0x${string}`
}
// ─── Loop principal ───────────────────────────────────────────────────────────

async function runAgent() {
  const privateKey = PRIVATE_KEYS[AGENT_INDEX]

  if (!privateKey) {
    console.error(`✗ No se encontró AGENT_${AGENT_INDEX}_PRIVATE_KEY en .env`)
    process.exit(1)
  }

  const { walletClient, publicClient, account } = createAgentClients(privateKey)

  console.log(`\n══════════════════════════════════════════`)
  console.log(`  VeilForge Agent #${AGENT_INDEX}`)
  console.log(`  Estrategia: ${STRATEGY}`)
  console.log(`  Address:    ${account.address}`)
  console.log(`══════════════════════════════════════════\n`)

  // Setup: register + approve tokens (with receipts — fix A-3)
  await setupAgent(walletClient, publicClient, account)

  let cycle = 0

  while (true) {
    cycle++
    console.log(`[${account.address.slice(0, 6)}] ── Cycle #${cycle} ──`)

    try {
      // 1. Calculate parameters based on strategy
      // [FIX A-4] pass publicClient to getArbitrageParams
      let params
      switch (STRATEGY) {
        case 'arbitrage':
          params = await getArbitrageParams(publicClient)
          break
        case 'conservative':
          params = getConservativeParams()
          break
        default:
          params = getNextOrderParams() // marketMaker
      }

      // 2. Commit
      const committed = await commitOrder(walletClient, publicClient, account, params)

      // 3. Wait for window — throws an error if expired (fix A-2)
      await waitForRevealWindow(publicClient, committed.commitBlock, account)

      // 4. Reveal
      await revealOrder(walletClient, publicClient, account, committed)

      console.log(`[${account.address.slice(0, 6)}] ✓ Cycle #${cycle} completed\n`)

    } catch (err: any) {
      console.error(`[${account.address.slice(0, 6)}] ✗ Error in cycle #${cycle}: ${err.message}`)

      // [FIX GAP-5] backoff based on error type — prevents slashing loop
      if (err.message.includes('Reveal window expired')) {
        console.warn(`[${account.address.slice(0, 6)}] ⚠ Window expired — waiting 15s`)
        await sleep(15_000)
        continue
      }

      if (err.message.includes('nonce') || err.message.includes('network')) {
        console.warn(`[${account.address.slice(0, 6)}] ⚠ Network error — waiting 5s`)
        await sleep(5_000)
        continue
      }

      // Unknown error — short backoff and continue
      await sleep(2_000)
    }

    // Standard delay between cycles
    await sleep(3_000)
  }
}
// ─── Global Error Handling ───────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection (Rejected Promise):', reason)
  process.exit(1)
})

// ─── Startup ─────────────────────────────────────────────────────────────────

runAgent().catch((err) => {
  console.error('Fatal Error:', err)
  process.exit(1)
})