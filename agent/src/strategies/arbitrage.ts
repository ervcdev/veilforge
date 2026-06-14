import { type OrderParams, type Direction } from '../commitReveal'
import { type PublicClient } from 'viem'
import { CLOB_ABI } from '../abis'

// [FIX A-4] receives publicClient as a parameter — does not create a new one on every call
export async function getArbitrageParams(
  publicClient: PublicClient
): Promise<OrderParams> {
  const clobAddress = process.env.COMMIT_REVEAL_CLOB_ADDRESS as `0x${string}`

  const openBids = await publicClient.readContract({
    address:      clobAddress,
    abi:          CLOB_ABI,
    functionName: 'getOpenBids'
  }) as bigint[]

  const openAsks = await publicClient.readContract({
    address:      clobAddress,
    abi:          CLOB_ABI,
    functionName: 'getOpenAsks'
  }) as bigint[]

  // [FIX A-8] iterate through all asks to find the best one (lowest price)
  // openAsks[0] is not necessarily the best — the array might be unsorted
  let bestAskId:    bigint | null = null
  let bestAskPrice                = BigInt('999999999999999999999999999999')

  for (const askId of openAsks) {
    const order = await publicClient.readContract({
      address:      clobAddress,
      abi:          CLOB_ABI,
      functionName: 'getOrder',
      args:         [askId]
    }) as any

    if (order.status === 1 && order.price < bestAskPrice) { // status 1 = REVEALED
      bestAskPrice = order.price
      bestAskId    = askId
    }
  }

  // If there is a revealed ask, place a slightly higher BID to cross the spread
  if (bestAskId !== null) {
    return {
      price:     bestAskPrice + BigInt(10 ** 15), // 0.001 USDC higher
      amount:    BigInt(1) * BigInt(10 ** 18),
      direction: 0 as Direction                   // BID
    }
  }

  // [FIX A-8] iterate through all bids to find the best one (highest price)
  let bestBidId:    bigint | null = null
  let bestBidPrice                = BigInt(0)

  for (const bidId of openBids) {
    const order = await publicClient.readContract({
      address:      clobAddress,
      abi:          CLOB_ABI,
      functionName: 'getOrder',
      args:         [bidId]
    }) as any

    if (order.status === 1 && order.price > bestBidPrice) { // status 1 = REVEALED
      bestBidPrice = order.price
      bestBidId    = bidId
    }
  }

  // If there is a revealed bid, place a slightly lower ASK to cross the spread
  if (bestBidId !== null) {
    return {
      price:     bestBidPrice - BigInt(10 ** 15), // 0.001 USDC lower
      amount:    BigInt(1) * BigInt(10 ** 18),
      direction: 1 as Direction                   // ASK
    }
  }

  // No arbitrage opportunity found — neutral order fallback
  return {
    price:     BigInt(3000) * BigInt(10 ** 18),
    amount:    BigInt(1) * BigInt(10 ** 18),
    direction: 0 as Direction
  }
}