import type { Kind, Lane } from './gameLogic.ts'
import { MYSTERY_REWARDS, SABER_COLORS } from './powerUps.ts'
import type { MysteryReward, SaberColor } from './powerUps.ts'

export const SPAWN_LANES = [-1, 0, 1] as const
export const SPAWN_KINDS = ['barrier', 'overhead', 'block', 'coin', 'mystery'] as const
export type SpawnOverrides = {
  lanes: readonly Lane[]
  kinds: readonly Kind[]
  rewards: readonly MysteryReward[]
  saberColors: readonly SaberColor[]
}

export function createSpawnOverrides(): SpawnOverrides {
  return { lanes: [...SPAWN_LANES], kinds: [...SPAWN_KINDS], rewards: [...MYSTERY_REWARDS], saberColors: [...SABER_COLORS] }
}

function validateChoices<T>(choices: readonly T[], allowed: readonly T[], label: string) {
  if (!choices.length || new Set(choices).size !== choices.length || choices.some(choice => !allowed.includes(choice))) {
    throw new RangeError(`Debug ${label} must contain at least one distinct, supported choice`)
  }
}

export function validateSpawnOverrides(overrides: SpawnOverrides) {
  validateChoices(overrides.lanes, SPAWN_LANES, 'lanes')
  validateChoices(overrides.kinds, SPAWN_KINDS, 'elements')
  validateChoices(overrides.rewards, MYSTERY_REWARDS, 'rewards')
  validateChoices(overrides.saberColors, SABER_COLORS, 'sword colors')
}
