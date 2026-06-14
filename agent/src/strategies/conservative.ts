import { type OrderParams, type Direction } from '../commitReveal'

// Wider spread and smaller amounts compared to the market maker
let lastDirection = 0

export function getConservativeParams(): OrderParams {
  const marketPrice = BigInt(3000) * BigInt(10 ** 18)
  const spreadBps   = BigInt(80)   // 0.80% — más conservador
  const spread      = (marketPrice * spreadBps) / BigInt(10000)

  lastDirection = lastDirection === 0 ? 1 : 0

  if (lastDirection === 0) {
    return {
      price:     marketPrice - spread,
      amount:    BigInt(5) * BigInt(10 ** 17), // 0.5 WETH
      direction: 0 as Direction
    }
  } else {
    return {
      price:     marketPrice + spread,
      amount:    BigInt(5) * BigInt(10 ** 17),
      direction: 1 as Direction
    }
  }
}