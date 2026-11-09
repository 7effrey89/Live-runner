import { advanceGame, newGame } from './gameLogic.ts'
import type { Game, Mode } from './gameLogic.ts'

export const MAX_PLAYERS = 4
export const PLAYER_COLORS = ['#d7f293', '#83dcff', '#ffbf84', '#d4a5ff'] as const
export type RunnerPlayer = { id: number; game: { current: Game } }
export type PlayerSnapshot = { id: number; game: Game; source: RunnerPlayer }

export function snapshotPlayers(players: readonly RunnerPlayer[]): PlayerSnapshot[] {
  return players.map(source => ({ id: source.id, source, game: { ...source.game.current, items: [...source.game.current.items] } }))
}

export function stopPlayers(players: readonly RunnerPlayer[]) {
  for (const player of players) {
    Object.assign(player.game.current, { phase: 'over', jumpBuffer: 0, jump: 0, lastJumpAt: -Infinity, slide: 0, recovery: 0, items: [] })
  }
}

export function setPlayerDifficulty(players: readonly RunnerPlayer[], difficulty: number) {
  for (const player of players) player.game.current.difficulty = difficulty
}

export function createPlayers(ids: readonly number[], mode: Mode = 'free-run', difficulty = 1, running = false): RunnerPlayer[] {
  if (ids.length < 1 || ids.length > MAX_PLAYERS || new Set(ids).size !== ids.length
    || ids.some(id => !Number.isInteger(id) || id < 0 || id >= MAX_PLAYERS)) throw new RangeError('Select one to four distinct player slots')
  return ids.map(id => ({ id, game: { current: { ...newGame(mode, difficulty), phase: running ? 'running' : 'ready' } } }))
}

export const avatarScale = (count: number) => Math.min(1, 1.65 / count)
export const playerOffset = (index: number, count: number) => (index - (count - 1) / 2) * (2.1 / count)

export function advanceMultiplayer(course: Game, players: readonly RunnerPlayer[], delta: number, random = Math.random) {
  const previousDistance = course.distance
  const sounds = new Set<'coin' | 'crash' | 'jump'>()
  advanceGame(course, delta, random, { collisions: false })
  const travel = course.distance - previousDistance
  for (const player of players) {
    const game = player.game.current
    if (course.phase !== 'running' && game.phase === 'running') continue
    if (course.phase === 'running' && game.phase === 'running') {
      game.distance = previousDistance
      game.difficulty = course.difficulty
      const nextId = game.nextId
      for (const item of course.items) {
        if (item.id >= nextId) {
          game.items.push({ ...item, z: item.z - travel })
          game.nextId = Math.max(game.nextId, item.id + 1)
        }
      }
      game.nextId = Math.max(game.nextId, course.nextId)
    }
    advanceGame(game, delta, random, { spawn: false }).forEach(sound => sounds.add(sound))
  }
  if (course.phase === 'running' && players.every(player => player.game.current.phase === 'over')) {
    course.phase = 'over'
    course.items = []
  }
  return [...sounds]
}

export function keyboardControl(key: string, count: number) {
  const bindings: Record<string, 'left' | 'right' | 'jump' | 'slide'>[] = [
    { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'slide', ' ': 'jump' },
    { a: 'left', d: 'right', w: 'jump', s: 'slide' },
    { j: 'left', l: 'right', i: 'jump', k: 'slide' },
    { f: 'left', h: 'right', t: 'jump', g: 'slide' },
  ]
  for (let index = 0; index < bindings.length; index++) {
    const action = bindings[index][key]
    const player = count === 1 && index === 1 ? 0 : index
    if (action && player < count) return { player, action }
  }
}
