import type { Game, Item } from './gameLogic.ts'
import type { SoundEffect } from './gameAudio.ts'
import type { Hand } from './handPointer.ts'
import { jumpHeight } from './runnerMotion.ts'

export type Ability = 'invisibility' | 'sword' | 'blaster' | 'fireball'
export type MysteryReward = Ability | 'bonus'
export const SABER_COLORS = ['blue', 'green', 'purple', 'red'] as const
export type SaberColor = typeof SABER_COLORS[number]
export const SABER_PALETTE: Record<SaberColor, string> = { blue: '#4fafff', green: '#57ff99', purple: '#bd6cff', red: '#ff4a60' }
export type Fireball = { id: number; lane: Game['lane']; z: number; age: number; hand: Hand; startHeight: number }
export type ActiveAbility = {
  remaining: number; swing: number; cooldown: number
  beam?: { remaining: number; distance: number }
} & ({ kind: 'invisibility' | 'blaster' } | { kind: 'sword'; saberColor: SaberColor } | { kind: 'fireball'; fireballs: Fireball[] })
export type Pickup = { kind: Ability | 'life' | 'coin'; remaining: number }
export const ABILITY_DURATION = 10
export const SWORD_SWING_DURATION = .35
export const SWORD_RANGE = 6
export const BLASTER_RANGE = 30
export const BLASTER_INTERVAL = .45
export const FIREBALL_SPEED = 24
export const FIREBALL_RANGE = 40
export const FIREBALL_INTERVAL = .45
export const MYSTERY_REWARDS: readonly MysteryReward[] = ['invisibility', 'sword', 'blaster', 'fireball', 'bonus']
export const ABILITY_LABELS: Record<Ability, string> = {
  invisibility: 'Invincibility', sword: 'Laser sword', blaster: 'Auto blaster', fireball: 'Fireballs',
}
export const fireballHeight = (fireball: Fireball) => {
  const bounce = .3 + Math.abs(Math.sin(fireball.age * Math.PI * 3)) * .9
  const blend = Math.min(1, fireball.age / .18)
  return fireball.startHeight * (1 - blend) + bounce * blend
}

export function abilityCountdown(ability: ActiveAbility | undefined) {
  return ability && ability.remaining > 0 && ability.remaining <= 3 ? Math.ceil(ability.remaining) : undefined
}

export const isObstacle = (item: Item) => item.kind === 'barrier' || item.kind === 'overhead' || item.kind === 'block'

export function destroyObstacle(item: Item) {
  if (!isObstacle(item) || item.hit || item.fall) return false
  item.hit = true
  delete item.jumpContactAt
  item.fall = { age: 0, x: 0, y: 0, vx: item.id % 2 ? -2.8 : 2.8, vy: 2.6, angle: 0, spin: 2.8 }
  return true
}

export function grantMysteryReward(game: Game, reward: MysteryReward, saberColor?: SaberColor, random = Math.random) {
  if (game.phase !== 'running' || game.recovery > 0) return false
  if (reward === 'bonus') {
    if (game.mode === 'survival') game.lives++
    else game.coins++
    game.pickup = { kind: game.mode === 'survival' ? 'life' : 'coin', remaining: 2 }
  } else {
    const base = { remaining: ABILITY_DURATION, swing: 0, cooldown: 0 }
    game.ability = reward === 'sword'
      ? { ...base, kind: reward, saberColor: saberColor ?? SABER_COLORS[Math.floor(random() * SABER_COLORS.length)] }
      : reward === 'fireball' ? { ...base, kind: reward, fireballs: [] } : { ...base, kind: reward }
    game.pickup = { kind: reward, remaining: 2 }
  }
  return true
}

export function swingSword(game: Game) {
  const ability = game.ability
  if (game.phase !== 'running' || game.recovery > 0 || ability?.kind !== 'sword'
    || ability.remaining <= 0 || ability.swing > 0) return false
  ability.swing = SWORD_SWING_DURATION
  return true
}

export function throwFireball(game: Game, hand: Hand = 'right') {
  const ability = game.ability
  if (game.phase !== 'running' || game.recovery > 0 || ability?.kind !== 'fireball'
    || ability.remaining <= 0 || ability.cooldown > 0) return false
  ability.fireballs.push({ id: game.nextProjectileId++, lane: game.lane, z: 0, age: 0, hand, startHeight: 1.1 + jumpHeight(game.jump) })
  ability.cooldown = FIREBALL_INTERVAL
  return true
}

export function attackWithAbility(game: Game, hand: Hand = 'right'): 'sword' | 'fireball' | undefined {
  if (swingSword(game)) return 'sword'
  if (throwFireball(game, hand)) return 'fireball'
}

export function advancePowerUps(game: Game, delta: number, attacks = true): SoundEffect[] {
  const sounds: SoundEffect[] = []
  if (game.phase !== 'running') {
    delete game.ability
    delete game.pickup
    return sounds
  }
  if (game.pickup) {
    game.pickup.remaining -= delta
    if (game.pickup.remaining <= 0) delete game.pickup
  }
  const ability = game.ability
  if (!ability) return sounds
  const previousSeconds = Math.ceil(ability.remaining)
  ability.remaining = Math.max(0, ability.remaining - delta)
  if (ability.remaining === 0) {
    delete game.ability
    return ['expire']
  }
  const seconds = Math.ceil(ability.remaining)
  if (seconds <= 3 && seconds < previousSeconds) sounds.push('countdown')
  ability.swing = Math.max(0, ability.swing - delta)
  ability.cooldown = Math.max(0, ability.cooldown - delta)
  if (ability.beam) {
    ability.beam.remaining -= delta
    if (ability.beam.remaining <= 0) delete ability.beam
  }
  if (!attacks) return sounds
  const dt = Math.min(delta, .05)
  if (ability.kind === 'fireball') {
    ability.fireballs = ability.fireballs.filter(fireball => {
      const previousZ = fireball.z
      fireball.age += delta
      fireball.z -= FIREBALL_SPEED * dt
      if (fireball.age >= 2 || fireball.z < -FIREBALL_RANGE) return false
      const target = game.items.filter(item => isObstacle(item) && !item.hit && !item.fall && item.lane === fireball.lane
        && previousZ - (item.z - game.speed * dt) >= -.6 && fireball.z - item.z <= .6)
        .reduce<Item | undefined>((nearest, item) => !nearest || item.z > nearest.z ? item : nearest, undefined)
      if (target && destroyObstacle(target)) {
        sounds.push('abilityHit')
        return false
      }
      return true
    })
  }
  if (game.recovery > 0) return sounds
  const targets = game.items.filter(item => isObstacle(item) && !item.hit && !item.fall && item.lane === game.lane)
  if (ability.kind === 'sword' && ability.swing > 0) {
    if (targets.filter(item => item.z >= -SWORD_RANGE && item.z <= .9 && destroyObstacle(item)).length > 0) sounds.push('abilityHit')
  }
  if (ability.kind === 'blaster' && ability.cooldown === 0) {
    const target = targets.filter(item => item.z >= -BLASTER_RANGE && item.z <= 0)
      .reduce<Item | undefined>((nearest, item) => !nearest || item.z > nearest.z ? item : nearest, undefined)
    if (target && destroyObstacle(target)) {
      ability.beam = { distance: -target.z, remaining: .16 }
      ability.cooldown = BLASTER_INTERVAL
      sounds.push('blaster', 'abilityHit')
    }
  }
  return sounds
}
