import { jumpTiming } from './difficulty.ts'
import { COLLISION_HALF_LENGTH } from './gameLogic.ts'
import type { Game, Item } from './gameLogic.ts'

export const GUIDE_TIMING_MARGIN = .06

export function jumpZone(item: Item, speed: number, difficulty: number) {
  if (item.kind !== 'barrier' && item.kind !== 'mystery' || item.hit || item.fall || item.jumpContactAt !== undefined || item.z >= -COLLISION_HALF_LENGTH) return
  const timing = jumpTiming(difficulty)
  // Stay inside the clearance window instead of recommending its fragile edges.
  return {
    near: item.z + COLLISION_HALF_LENGTH + speed * (timing.start + GUIDE_TIMING_MARGIN),
    far: item.z + COLLISION_HALF_LENGTH + speed * (timing.end - GUIDE_TIMING_MARGIN),
  }
}

export function jumpNow(game: Game) {
  if (game.phase !== 'running' || game.recovery > 0 || game.jump > 0 || game.slide > 0) return false
  return game.items.some(item => {
    if (item.lane !== game.lane) return false
    if (item.kind === 'barrier' && game.ability?.kind === 'invisibility') return false
    const zone = jumpZone(item, game.speed, game.difficulty)
    return zone !== undefined && inJumpZone(zone)
  })
}

export function inJumpZone(zone: { near: number; far: number }) {
  return zone.near <= 1e-6 && zone.far >= -1e-6
}
