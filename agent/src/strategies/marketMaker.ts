import { type OrderParams, type Direction } from '../commitReveal'

// Simulated base price — in production replace with Somnia JSON API Agent price
let basePrice = BigInt(3000) * BigInt(10 ** 18)  // 3000 USDC en 18 decimals

export function getMarketPrice(): bigint {
  // Simula pequeñas variaciones de precio ±10 USDC
  const variation = BigInt(Math.floor(Math.random() * 20) - 10)
  return basePrice + variation * BigInt(10 ** 18)
}

export function updateBasePrice(newPrice: bigint) {
  basePrice = newPrice
}

export function calculateBidParams(): OrderParams {
  const marketPrice = getMarketPrice()
  const spreadBps   = BigInt(30)  // 0.30% spread
  const spread      = (marketPrice * spreadBps) / BigInt(10000)

  return {
    price:     marketPrice - spread,
    amount:    BigInt(1) * BigInt(10 ** 18), // 1 WETH
    direction: 0 as Direction                // BID
  }
}

export function calculateAskParams(): OrderParams {
  const marketPrice = getMarketPrice()
  const spreadBps   = BigInt(30)
  const spread      = (marketPrice * spreadBps) / BigInt(10000)

  return {
    price:     marketPrice + spread,
    amount:    BigInt(1) * BigInt(10 ** 18),
    direction: 1 as Direction                // ASK
  }
}

// Alternates between BID and ASK every cycle
let lastDirection = 1

export function getNextOrderParams(): OrderParams {
  lastDirection = lastDirection === 0 ? 1 : 0
  return lastDirection === 0 ? calculateBidParams() : calculateAskParams()
}