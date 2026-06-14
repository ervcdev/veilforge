// VeilForge — commitReveal.ts (Final Deployment Version)
// Applied fixes: TS-FINAL-1 (Full account object), A-1 (orderId from events), 
// A-2 (maxBlock check), A-3 (waitForTransactionReceipt in setup), A-6 (Clean imports),
// GAP-3 (Pre-hash validation), TS-4 (Explicit somniaTestnet), ADAPTER-DOUBLE-APPROVAL (Core + Adapter approvals)

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  encodePacked,
  keccak256,
  decodeEventLog,
  type WalletClient,
  type PublicClient
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaTestnet } from './config'          
import { CLOB_ABI, ERC20_ABI, REGISTRY_ABI } from './abis'
import * as crypto from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Direction = 0 | 1  // 0 = BID, 1 = ASK

export interface OrderParams {
  price:  bigint    // Price in USDC with 18 decimals
  amount: bigint    // Amount of tokenA with 18 decimals
  direction: Direction
}

export interface CommittedOrder {
  orderId:     bigint
  params:      OrderParams
  salt:        `0x${string}`
  commitBlock: bigint
}

// In-memory state to securely store the salt between cycles
const pendingOrders = new Map<bigint, CommittedOrder>()
let cachedClobAddress: `0x${string}` | null = null

// ─── customers Viem ────────────────────────────────────────────────────────────

export function createAgentClients(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    chain:     somniaTestnet,                      
    transport: http(process.env.SOMNIA_RPC_URL!)
  })

  const publicClient = createPublicClient({
    chain:     somniaTestnet,                      
    transport: http(process.env.SOMNIA_RPC_URL!)
  })

  return { walletClient, publicClient, account }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateSalt(): `0x${string}` {
  const bytes = crypto.randomBytes(32)
  return `0x${bytes.toString('hex')}`
}

export function hashOrder(params: OrderParams, salt: `0x${string}`): `0x${string}` {
  if (params.direction !== 0 && params.direction !== 1) {
    throw new Error(`Direction inválida: ${params.direction}. Debe ser 0 (BID) o 1 (ASK)`)
  }
  if (params.price <= BigInt(0)) throw new Error(`Price inválido: ${params.price}. Debe ser > 0`)
  if (params.amount <= BigInt(0)) throw new Error(`Amount inválido: ${params.amount}. Debe ser > 0`)

  return keccak256(
    encodePacked(
      ['uint256', 'uint256', 'uint8', 'bytes32'],
      [params.price, params.amount, params.direction, salt]
    )
  )
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function getPendingOrders(): Map<bigint, CommittedOrder> {
  return pendingOrders
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

function getRegistryAddress(): `0x${string}` {
  const registry = process.env.AGENT_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!registry) throw new Error('Falta AGENT_REGISTRY_ADDRESS en .env')
  return registry
}

/** Source of truth: registry.clobContract(), falling back to .env if the deployment omitted setCLOBContract */async function resolveClobAddress(publicClient: PublicClient): Promise<`0x${string}`> {
  const registryAddress = getRegistryAddress()
  const envClob = process.env.COMMIT_REVEAL_CLOB_ADDRESS as `0x${string}` | undefined

  const onChainClob = await publicClient.readContract({
    address:      registryAddress,
    abi:          REGISTRY_ABI,
    functionName: 'clobContract',
  }) as `0x${string}`

  if (onChainClob.toLowerCase() !== ZERO_ADDRESS) {
    if (envClob && envClob.toLowerCase() !== onChainClob.toLowerCase()) {
      console.warn(
        `[WARN] COMMIT_REVEAL_CLOB_ADDRESS (${envClob}) ≠ registry.clobContract() (${onChainClob}). ` +
        `Usando la dirección on-chain.`
      )
    }
    return onChainClob
  }

  if (!envClob) {
    throw new Error(
      'registry.clobContract() = address(0) y falta COMMIT_REVEAL_CLOB_ADDRESS en .env. ' +
      'Ejecuta: cd contracts && bash script/link-clob.sh'
    )
  }

  const linkedRegistry = await publicClient.readContract({
    address:      envClob,
    abi:          CLOB_ABI,
    functionName: 'registry',
  }) as `0x${string}`

  if (linkedRegistry.toLowerCase() !== registryAddress.toLowerCase()) {
    throw new Error(
      `COMMIT_REVEAL_CLOB_ADDRESS (${envClob}) no apunta al registry configurado (${registryAddress})`
    )
  }

  console.warn(
    `[WARN] registry.clobContract() = address(0). ` +
    `Usando COMMIT_REVEAL_CLOB_ADDRESS=${envClob}. ` +
    `commitOrder fallará hasta enlazar: cd contracts && bash script/link-clob.sh`
  )
  return envClob
}

async function getClobAddress(publicClient: PublicClient): Promise<`0x${string}`> {
  if (!cachedClobAddress) {
    cachedClobAddress = await resolveClobAddress(publicClient)
  }
  return cachedClobAddress
}

async function getRevealWindowBlocks(
  publicClient: PublicClient,
  clobAddress:  `0x${string}`
): Promise<bigint> {
  return publicClient.readContract({
    address:      clobAddress,
    abi:          CLOB_ABI,
    functionName: 'REVEAL_WINDOW',
  }) as Promise<bigint>
}

async function assertClobLinked(publicClient: PublicClient, clobAddress: `0x${string}`): Promise<void> {
  const registryAddress = getRegistryAddress()
  const onChainClob = await publicClient.readContract({
    address:      registryAddress,
    abi:          REGISTRY_ABI,
    functionName: 'clobContract',
  }) as `0x${string}`

  if (onChainClob.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(
      'registry.clobContract() sigue en address(0). ' +
      'Ejecuta una vez: cd contracts && bash script/link-clob.sh'
    )
  }

  if (onChainClob.toLowerCase() !== clobAddress.toLowerCase()) {
    throw new Error(
      `CLOB en uso (${clobAddress}) ≠ registry.clobContract() (${onChainClob})`
    )
  }
}

async function resolveAdapterAddress(
  publicClient: PublicClient,
  clobAddress:  `0x${string}`
): Promise<`0x${string}` | null> {
  const envAdapter = process.env.REACTIVITY_ADAPTER_ADDRESS as `0x${string}` | undefined

  let keeper: `0x${string}` | null = null
  try {
    keeper = await publicClient.readContract({
      address:      clobAddress,
      abi:          CLOB_ABI,
      functionName: 'keeperAddress',
    }) as `0x${string}`
  } catch {
    // keeperAddress may not exist in legacy deployments
  }

  const adapter = keeper && keeper.toLowerCase() !== ZERO_ADDRESS
    ? keeper
    : envAdapter

  if (!adapter || adapter.toLowerCase() === ZERO_ADDRESS) return null

  if (adapter.toLowerCase() === clobAddress.toLowerCase()) {
    console.warn('[WARN] Adapter apunta al mismo address que el CLOB — omitiendo approvals al adapter')
    return null
  }

  if (envAdapter && keeper && keeper.toLowerCase() !== ZERO_ADDRESS &&
      envAdapter.toLowerCase() !== keeper.toLowerCase()) {
    console.warn(
      `[WARN] REACTIVITY_ADAPTER_ADDRESS (${envAdapter}) ≠ CLOB.keeperAddress (${keeper}). ` +
      `Usando keeper on-chain.`
    )
  }

  return adapter
}

// ─── Agent Initial Setup ─────────────────────────────────────────────────

export async function setupAgent(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account:      ReturnType<typeof privateKeyToAccount>
) {
  const registryAddress = getRegistryAddress()
  const clobAddress     = await getClobAddress(publicClient)
  const adapterAddress  = await resolveAdapterAddress(publicClient, clobAddress)
  const tokenAAddress   = process.env.TOKEN_A_ADDRESS             as `0x${string}`
  const tokenBAddress   = process.env.TOKEN_B_ADDRESS             as `0x${string}`
  const collateral      = parseEther(process.env.COLLATERAL_AMOUNT || '0.01')
  const MAX_UINT        = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

  console.log(`[${account.address.slice(0, 6)}] CLOB Core:  ${clobAddress}`)
  if (adapterAddress) {
    console.log(`[${account.address.slice(0, 6)}] Adapter:    ${adapterAddress}`)
  }

  // 1. Register agent on the network if not already registered
  const isRegistered = await publicClient.readContract({
    address:      registryAddress,
    abi:          REGISTRY_ABI,
    functionName: 'isRegistered',
    args:         [account.address]
  }) as boolean

  if (!isRegistered) {
    console.log(`[${account.address.slice(0, 6)}] Registrando agente...`)
    const txHash = await walletClient.writeContract({
      address:      registryAddress,
      abi:          REGISTRY_ABI,
      functionName: 'registerAgent',
      value:        collateral,
      account:      account, 
      chain:        somniaTestnet,
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash })
    console.log(`[${account.address.slice(0, 6)}] ✓ Registrado con éxito`)
  } else {
    console.log(`[${account.address.slice(0, 6)}] ✓ Ya registrado`)
  }

 // Internal helper to validate and execute cross-approvals without duplicating code blocks
  const ensureAllowance = async (tokenAddress: `0x${string}`, spender: `0x${string}`, tokenName: string) => {
    const allowance = await publicClient.readContract({
      address:      tokenAddress,
      abi:          ERC20_ABI,
      functionName: 'allowance',
      args:         [account.address, spender]
    }) as bigint

    if (allowance < parseEther('1000')) {
      console.log(`[${account.address.slice(0, 6)}] Aprobando ${tokenName} al contrato ${spender.slice(0, 6)}...`)
      const txHash = await walletClient.writeContract({
        address:      tokenAddress,
        abi:          ERC20_ABI,
        functionName: 'approve',
        args:         [spender, MAX_UINT],
        account,
        chain:        somniaTestnet,
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      console.log(`[${account.address.slice(0, 6)}] ✓ ${tokenName} autorizado para ${spender.slice(0, 6)}`)
    }
  }

  // 2. Allowances to the CLOB Core (required) and to the Adapter (if it exists)
  await ensureAllowance(tokenAAddress, clobAddress, 'TokenA (CLOB Core)')
  await ensureAllowance(tokenBAddress, clobAddress, 'TokenB (CLOB Core)')
  if (adapterAddress) {
    await ensureAllowance(tokenAAddress, adapterAddress, 'TokenA (Reactivity Adapter)')
    await ensureAllowance(tokenBAddress, adapterAddress, 'TokenB (Reactivity Adapter)')
  }

  console.log(`[${account.address.slice(0, 6)}] ✓ Setup completo e infraestructura completamente autorizada\n`)
}

// ─── Commit Directo al CLOB Core ──────────────────────────────────────────────

export async function commitOrder(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account:      ReturnType<typeof privateKeyToAccount>,
  params:       OrderParams
): Promise<CommittedOrder> {
  const registryAddress = getRegistryAddress()
  const clobAddress     = await getClobAddress(publicClient)

  const salt       = generateSalt()
  const commitment = hashOrder(params, salt)

  console.log(
    `[${account.address.slice(0, 6)}] Committing ` +
    `${params.direction === 0 ? 'BID' : 'ASK'} ` +
    `${params.amount / BigInt(10 ** 18)} WETH @ ` +
    `${params.price  / BigInt(10 ** 18)} USDC`
  )

  const [registered, clobRegistry] = await Promise.all([
    publicClient.readContract({
      address:      registryAddress,
      abi:          REGISTRY_ABI,
      functionName: 'isRegistered',
      args:         [account.address],
    }) as Promise<boolean>,
    publicClient.readContract({
      address:      clobAddress,
      abi:          CLOB_ABI,
      functionName: 'registry',
    }) as Promise<`0x${string}`>,
  ])

  console.log(`[${account.address.slice(0, 6)}] Pre-commit:`)
  console.log(`  target:     ${clobAddress}  (registry.clobContract)`)
  console.log(`  registry:   ${registryAddress}`)
  console.log(`  linked:     ${clobRegistry}`)
  console.log(`  registered: ${registered}`)
  console.log(`  commitment: ${commitment}`)
  console.log(`  params:     price=${params.price} amount=${params.amount} dir=${params.direction}`)

  if (!registered) {
    throw new Error('Agente no registrado — ejecuta setupAgent() antes de commitOrder')
  }

  if (clobRegistry.toLowerCase() !== registryAddress.toLowerCase()) {
    throw new Error(
      `CLOB.registry() (${clobRegistry}) no coincide con AGENT_REGISTRY_ADDRESS (${registryAddress})`
    )
  }

  await assertClobLinked(publicClient, clobAddress)

  await publicClient.simulateContract({
    address:      clobAddress,
    abi:          CLOB_ABI,
    functionName: 'commitOrder',
    args:         [commitment],
    account,
  })

  const txHash = await walletClient.writeContract({
    address:      clobAddress, 
    abi:          CLOB_ABI,
    functionName: 'commitOrder',
    args:         [commitment],
    account:      account,
    chain:        somniaTestnet,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  let orderId: bigint | undefined

  // Decode Core log to extract the unique ID generated by the blockchain
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi:       CLOB_ABI,
        data:      log.data,
        topics:    log.topics,
        eventName: 'OrderCommitted'
      })
      if ((decoded.args as any).agent?.toLowerCase() === account.address.toLowerCase()) {
        orderId = (decoded.args as any).orderId as bigint
        break
      }
    } catch {
      continue 
    }
  }

  if (orderId === undefined) {
    throw new Error('No se encontró evento OrderCommitted en el receipt.')
  }

  const commitBlock = BigInt(receipt.blockNumber)
  const committed: CommittedOrder = { orderId, params, salt, commitBlock }
  pendingOrders.set(orderId, committed)

  console.log(`[${account.address.slice(0, 6)}] ✓ Commit exitoso — orderId=${orderId} bloque=${commitBlock}`)
  return committed
}

// ─── Waiting Window Definition ────────────────────────────────────────────────────────

export async function waitForRevealWindow(
  publicClient: PublicClient,
  commitBlock:  bigint,
  account:      ReturnType<typeof privateKeyToAccount>
) {
  const clobAddress    = await getClobAddress(publicClient)
  const revealWindow   = await getRevealWindowBlocks(publicClient, clobAddress)
  const targetBlock    = commitBlock + BigInt(1)
  const lastValidBlock = commitBlock + revealWindow

  console.log(
    `[${account.address.slice(0, 6)}] Esperando bloque ${targetBlock} ` +
    `(ventana válida hasta bloque ${lastValidBlock}, REVEAL_WINDOW=${revealWindow})...`
  )

  while (true) {
    const currentBlock = await publicClient.getBlockNumber()

    if (currentBlock > lastValidBlock) {
      throw new Error(
        `Reveal window expiró — commit: ${commitBlock}, actual: ${currentBlock}, max: ${lastValidBlock}`
      )
    }
    if (currentBlock >= targetBlock) {
      console.log(
        `[${account.address.slice(0, 6)}] ✓ Bloque ${currentBlock} — enviando reveal ahora ` +
        `(quedan ${lastValidBlock - currentBlock} bloques)`
      )
      return
    }

    await sleep(100)
  }
}

// ─── Reveal Directo al CLOB Core ──────────────────────────────────────────────

export async function revealOrder(
  walletClient: WalletClient,
  publicClient: PublicClient,
  account:      ReturnType<typeof privateKeyToAccount>,
  committed:    CommittedOrder
): Promise<boolean> {
  const clobAddress = await getClobAddress(publicClient)

  try {
    const revealWindow   = await getRevealWindowBlocks(publicClient, clobAddress)
    const lastValidBlock = committed.commitBlock + revealWindow
    const currentBlock   = await publicClient.getBlockNumber()

    if (currentBlock > lastValidBlock) {
      throw new Error(
        `Reveal window expiró antes de enviar — actual: ${currentBlock}, max: ${lastValidBlock}`
      )
    }

    console.log(
      `[${account.address.slice(0, 6)}] Revelando orderId=${committed.orderId} ` +
      `(bloque ${currentBlock}/${lastValidBlock})...`
    )

    const txHash = await walletClient.writeContract({
      address:      clobAddress,
      abi:          CLOB_ABI,
      functionName: 'revealOrder',
      args: [
        committed.orderId,
        committed.params.price,
        committed.params.amount,
        committed.params.direction,
        committed.salt
      ],
      account,
      chain:        somniaTestnet,
    })

    await publicClient.waitForTransactionReceipt({ hash: txHash })
    pendingOrders.delete(committed.orderId)

    console.log(`[${account.address.slice(0, 6)}] ✓ Reveal exitoso — orderId=${committed.orderId}`)
    return true

  } catch (err: any) {
    console.error(`[${account.address.slice(0, 6)}] ✗ Error en reveal: ${err.message}`)
    // Do not delete the ID if it was a window error, in order to retry reveal or clean up
    return false
  }
}