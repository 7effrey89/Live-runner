import { JUMP_BUFFER_DURATION, JUMP_DURATION, jumpHeight } from './runnerMotion.ts'
import { DEFAULT_DIFFICULTY, jumpTiming } from './difficulty.ts'
import { advancePowerUps, destroyObstacle, grantMysteryReward, isObstacle, MYSTERY_REWARDS, SABER_COLORS } from './powerUps.ts'
import type { ActiveAbility, MysteryReward, Pickup, SaberColor } from './powerUps.ts'
import type { SoundEffect } from './gameAudio.ts'
import { SPAWN_LANES, validateSpawnOverrides } from './debugMode.ts'
import type { SpawnOverrides } from './debugMode.ts'

export type Lane = -1 | 0 | 1
export type Mode = 'free-run' | 'survival'
export type Kind = 'barrier' | 'overhead' | 'block' | 'coin' | 'mystery'
export type Fall = { age: number; x: number; y: number; vx: number; vy: number; angle: number; spin: number }
export type Item = { id: number; lane: Lane; z: number; hit: boolean; fall?: Fall; jumpContactAt?: number }
  & ({ kind: 'mystery'; reward: MysteryReward; saberColor?: SaberColor } | { kind: Exclude<Kind, 'mystery'> })
export type Game = {
  phase: 'ready' | 'running' | 'over'; mode: Mode; lane: Lane; jump: number; slide: number
  distance: number; coins: number; speed: number; items: Item[]; nextSpawn: number; nextId: number
  lives: number; penalty: number; lastPenalty: number; recovery: number; impact: 'fall' | 'stumble'
  jumpBuffer: number; jumpId: number; difficulty: number; time: number; lastJumpAt: number
  nextMystery: number; nextProjectileId: number; ability?: ActiveAbility; pickup?: Pickup
}
export const FREE_RUN_PENALTY = 100
export const RECOVERY_DURATION = 1.6
export const FALL_DURATION = 3
export const MIN_RUN_SPEED = 15
export const MAX_RUN_SPEED = 31
export const COLLISION_HALF_LENGTH = .9
export const speedAtDistance = (distance: number) => Math.min(MAX_RUN_SPEED, MIN_RUN_SPEED + Math.max(0, distance) / 180)
export const laneX = (lane: Lane) => lane * 2.5
export const newGame = (mode: Mode = 'free-run', difficulty = DEFAULT_DIFFICULTY): Game => ({
  phase: 'ready', mode, lane: 0, jump: 0, slide: 0, distance: 0,
  coins: 0, speed: MIN_RUN_SPEED, items: [], nextSpawn: 35, nextId: 0, jumpBuffer: 0, jumpId: 0,
  lives: 5, penalty: 0, lastPenalty: 0, recovery: 0, impact: 'stumble',
  difficulty, time: 0, lastJumpAt: -Infinity, nextMystery: 0, nextProjectileId: 0,
})
export const scoreOf = (game: Game) => Math.max(0, Math.floor(game.distance) + game.coins * 50 - game.penalty)
export const fallOpacity = (age: number) => Math.max(0, Math.min(1, (FALL_DURATION - age) / 1.8))

export function requestJump(game: Game) {
  if (game.phase !== 'running' || game.recovery > 0) return false
  if (game.jump > 0 || game.slide > 0) {
    game.jumpBuffer = JUMP_BUFFER_DURATION
    return false
  }
  game.jump = JUMP_DURATION
  game.lastJumpAt = game.time
  game.jumpId++
  game.jumpBuffer = 0
  return true
}

export function hitObstacle(game: Game, item: Item) {
  if (!isObstacle(item) || item.hit || item.fall || game.phase !== 'running') return false
  if (game.ability?.kind === 'invisibility' && game.ability.remaining > 0) {
    item.hit = true
    delete item.jumpContactAt
    return false
  }
  destroyObstacle(item)
  if (game.recovery > 0) return false
  game.recovery = RECOVERY_DURATION
  game.impact = item.kind === 'block' ? 'fall' : 'stumble'
  game.jump = 0
  game.lastJumpAt = -Infinity
  game.jumpBuffer = 0
  game.slide = 0
  if (game.mode === 'free-run') {
    game.lastPenalty = Math.min(FREE_RUN_PENALTY, scoreOf(game))
    game.penalty += game.lastPenalty
  } else {
    game.lives = Math.max(0, game.lives - 1)
    if (game.lives === 0) {
      game.phase = 'over'
      delete game.ability
      delete game.pickup
    }
  }
  return true
}

function advanceFall(fall: Fall, delta: number) {
  fall.age += delta
  let remaining = Math.min(delta, 0.25)
  while (remaining > 0) {
    const dt = Math.min(remaining, 1 / 60)
    fall.x += fall.vx * dt
    fall.vx *= Math.exp(-0.8 * dt)
    fall.vy -= 9.8 * dt
    fall.y += fall.vy * dt
    if (fall.y < 0) {
      fall.y = 0
      fall.vy = Math.abs(fall.vy) > 0.6 ? -fall.vy * 0.22 : 0
    }
    fall.spin += 6 * dt
    fall.angle += fall.spin * dt
    if (fall.angle >= Math.PI / 2) {
      fall.angle = Math.PI / 2
      fall.spin = Math.abs(fall.spin) > 0.3 ? -fall.spin * 0.18 : 0
    }
    remaining -= dt
  }
}

export function recoveryPose(remaining: number, kind: Game['impact']) {
  if (remaining <= 0) return { pitch: 0, roll: 0, lift: 0 }
  const age = RECOVERY_DURATION - remaining
  const rise = Math.min(1, age / 0.3)
  const recover = 1 - Math.max(0, Math.min(1, (age - 0.55) / 0.8))
  const amount = rise * recover
  if (amount === 0) return { pitch: 0, roll: 0, lift: 0 }
  return {
    pitch: -(kind === 'fall' ? 1.3 : 0.65) * amount,
    roll: Math.sin(age * 12) * amount * (kind === 'fall' ? 0.12 : 0.25),
    lift: Math.abs(Math.sin(age * 10)) * amount * 0.07,
  }
}

export function advanceGame(game: Game, delta: number, random = Math.random, options: { spawn?: boolean; collisions?: boolean; spawnOverrides?: SpawnOverrides } = {}) {
  const overrides = options.spawnOverrides
  if (overrides) validateSpawnOverrides(overrides)
  const sounds: SoundEffect[] = []
  game.recovery = Math.max(0, game.recovery - delta)
  const running = game.phase === 'running'
  const dt = Math.min(delta, 0.05)
  const speed = speedAtDistance(game.distance)
  const travel = running ? speed * dt : 0
  const previousTime = game.time
  if (running) {
    if (game.jump > 0) game.lastJumpAt = game.time - (JUMP_DURATION - game.jump)
    game.time += delta
    game.speed = speed
    game.distance += travel
    const buffer = game.jumpBuffer
    const wait = Math.max(game.jump, game.slide)
    game.jump = Math.max(0, game.jump - delta)
    game.slide = Math.max(0, game.slide - dt)
    game.jumpBuffer = Math.max(0, buffer - delta)
    if (buffer > 0 && wait <= Math.min(buffer, delta) && game.slide === 0 && game.recovery === 0) {
      game.jump = Math.max(0, JUMP_DURATION - (delta - wait))
      game.lastJumpAt = game.time - (delta - wait)
      game.jumpId++
      game.jumpBuffer = 0
      sounds.push('jump')
    }
    game.nextSpawn -= travel
    game.nextMystery -= travel
    if (game.nextSpawn <= 0 && options.spawn !== false) {
      const lanes = overrides?.lanes ?? SPAWN_LANES
      const lane = lanes[Math.floor(random() * lanes.length)]
      const choice = random()
      const kinds = overrides?.kinds ?? (game.nextMystery <= 0 ? ['mystery'] as const : ['barrier', 'overhead', 'block'] as const)
      const kind = kinds[Math.floor(choice * kinds.length)]
      if (kind === 'mystery') {
        const rewards = overrides?.rewards ?? MYSTERY_REWARDS
        const reward = rewards[Math.floor((overrides ? random() : choice) * rewards.length)]
        const colors = overrides?.saberColors ?? SABER_COLORS
        const saberColor = reward === 'sword' ? colors[Math.floor(random() * colors.length)] : undefined
        game.items.push({ id: game.nextId++, lane, z: -85, kind: 'mystery', reward, saberColor, hit: false })
        game.nextMystery = 140
      } else {
        game.items.push({ id: game.nextId++, lane, z: -85, kind, hit: false })
      }
      if (!overrides) {
        const coinLane = (lane === 1 ? -1 : lane + 1) as Lane
        for (let i = 0; i < 3; i++) game.items.push({ id: game.nextId++, lane: coinLane, z: -85 - i * 3, kind: 'coin', hit: false })
      }
      game.nextSpawn = 20 + random() * 8
    }
  }
  const timing = jumpTiming(game.difficulty)
  const jumpClears = (from: number, to: number) => from <= to && Number.isFinite(game.lastJumpAt)
    && to >= game.lastJumpAt && to > game.lastJumpAt + timing.start && from < game.lastJumpAt + timing.end
  for (const item of game.items) {
    if (item.fall) {
      advanceFall(item.fall, delta)
      item.z += travel * 0.12
    } else if (running && game.phase === 'running') {
      item.z += travel
    }
  }
  sounds.push(...advancePowerUps(game, delta, options.collisions !== false))
  for (const item of game.items) {
    if (item.fall) continue
    if (!running || game.phase !== 'running') continue
    if (options.collisions === false) continue
    if (!item.hit && isObstacle(item) && game.ability?.kind === 'invisibility' && game.ability.remaining > 0
      && (item.jumpContactAt !== undefined || Math.abs(item.z) < COLLISION_HALF_LENGTH && item.lane === game.lane)) {
      item.hit = true
      delete item.jumpContactAt
      continue
    }
    // Keep an already-contacted barrier unresolved briefly so a late real jump
    // can save it; a crouch or lane change alone cannot dismiss the contact.
    if (item.jumpContactAt !== undefined) {
      const deadline = item.jumpContactAt + timing.allowance
      if (jumpClears(previousTime, Math.min(game.time, deadline))) {
        item.hit = true
        delete item.jumpContactAt
      } else if (game.time >= deadline) {
        delete item.jumpContactAt
        if (hitObstacle(game, item)) sounds.push('crash')
      }
      continue
    }
    if (item.hit || Math.abs(item.z) >= COLLISION_HALF_LENGTH || item.lane !== game.lane) continue
    if (item.kind === 'mystery') {
      if (game.recovery === 0 && jumpHeight(game.jump) > .65 && grantMysteryReward(game, item.reward, item.saberColor)) {
        item.hit = true
        sounds.push('powerup')
      }
    } else if (item.kind === 'coin') {
      item.hit = true
      game.coins++
      sounds.push('coin')
    } else if ((item.kind === 'barrier' && jumpClears(game.time, game.time)) || (item.kind === 'overhead' && game.slide > 0)) {
      item.hit = true
    } else if (item.kind === 'barrier' && timing.allowance > 0 && game.recovery === 0) {
      item.jumpContactAt = game.time
    } else if (hitObstacle(game, item)) sounds.push('crash')
  }
  game.items = game.items.filter(item => item.fall ? item.fall.age < FALL_DURATION : game.phase !== 'over' && item.z < 8 && !(item.hit && (item.kind === 'coin' || item.kind === 'mystery')))
  return sounds
}
