import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSpawnOverrides, SPAWN_KINDS, SPAWN_LANES, validateSpawnOverrides } from '../src/debugMode.ts'
import type { SpawnOverrides } from '../src/debugMode.ts'
import { advanceGame, newGame } from '../src/gameLogic.ts'
import { advanceMultiplayer, createPlayers } from '../src/multiplayer.ts'
import { MYSTERY_REWARDS, SABER_COLORS } from '../src/powerUps.ts'

function running() {
  const game = newGame('survival')
  game.phase = 'running'
  game.nextSpawn = 0
  return game
}

test('default debug pools are complete, independently created, and valid', () => {
  const first = createSpawnOverrides()
  const second = createSpawnOverrides()
  assert.deepEqual(first, { lanes: SPAWN_LANES, kinds: SPAWN_KINDS, rewards: MYSTERY_REWARDS, saberColors: SABER_COLORS })
  validateSpawnOverrides(first)
  for (const key of ['lanes', 'kinds', 'rewards', 'saberColors'] as const) {
    assert.notEqual(first[key], second[key])
  }
})

test('absent overrides preserve normal mystery/obstacle waves, coin trails, and random draws', () => {
  for (const nextMystery of [0, 100]) {
    const game = running()
    game.nextMystery = nextMystery
    let calls = 0
    advanceGame(game, 0, () => { calls++; return .5 }, { spawnOverrides: undefined })
    assert.equal(calls, 3)
    assert.equal(game.items.length, 4)
    assert.equal(game.items[0].kind, nextMystery ? 'overhead' : 'mystery')
    assert.equal(game.items[0].lane, 0)
    assert.deepEqual(game.items.slice(1).map(item => [item.kind, item.lane, item.z]), [
      ['coin', 1, -85], ['coin', 1, -88], ['coin', 1, -91],
    ])
    assert.equal(game.nextSpawn, 24)
  }
})

test('every element can be forced into each lane, without unselected coin trails or mystery cooldown restrictions', () => {
  for (const lane of SPAWN_LANES) for (const kind of SPAWN_KINDS) {
    const game = running()
    game.nextMystery = 10000
    const spawnOverrides: SpawnOverrides = {
      lanes: [lane], kinds: [kind], rewards: ['fireball'], saberColors: ['purple'],
    }
    advanceGame(game, 0, () => .999, { spawnOverrides })
    assert.equal(game.items.length, 1)
    assert.equal(game.items[0].lane, lane)
    assert.equal(game.items[0].kind, kind)
    assert.equal(game.items[0].z, -85)
    assert.equal(game.items[0].hit, false)
    assert.ok(game.nextSpawn >= 20 && game.nextSpawn <= 28)
    if (game.items[0].kind === 'mystery') assert.equal(game.items[0].reward, 'fireball')
  }
})

test('mixed debug pools select independently and never emit excluded lanes, elements, rewards, or colors', () => {
  const game = running()
  const spawnOverrides: SpawnOverrides = {
    lanes: [-1, 1], kinds: ['coin', 'mystery'], rewards: ['fireball', 'sword'], saberColors: ['red', 'purple'],
  }
  let seed = 123
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32
  for (let wave = 0; wave < 100; wave++) {
    game.nextSpawn = 0
    advanceGame(game, 0, random, { spawnOverrides })
  }
  assert.equal(game.items.length, 100)
  for (const item of game.items) {
    assert.ok(spawnOverrides.lanes.includes(item.lane))
    assert.ok(spawnOverrides.kinds.includes(item.kind))
    if (item.kind === 'mystery') {
      assert.ok(spawnOverrides.rewards.includes(item.reward))
      if (item.reward === 'sword') {
        assert.ok(item.saberColor !== undefined && spawnOverrides.saberColors.includes(item.saberColor))
      }
    }
  }
  assert.equal(new Set(game.items.map(item => item.lane)).size, 2)
  assert.equal(new Set(game.items.map(item => item.kind)).size, 2)
  const boxes = game.items.filter(item => item.kind === 'mystery')
  assert.equal(new Set(boxes.map(item => item.reward)).size, 2)
  assert.equal(new Set(boxes.filter(item => item.reward === 'sword').map(item => item.saberColor)).size, 2)
})

test('forced box rewards and sword colors use the normal pickup and mode-specific bonus logic', () => {
  for (const mode of ['survival', 'free-run'] as const) for (const reward of MYSTERY_REWARDS) for (const saberColor of SABER_COLORS) {
    const game = running()
    game.mode = mode
    const spawnOverrides: SpawnOverrides = { lanes: [0], kinds: ['mystery'], rewards: [reward], saberColors: [saberColor] }
    advanceGame(game, 0, () => .5, { spawnOverrides })
    const box = game.items[0]
    assert.equal(box.kind, 'mystery')
    if (box.kind !== 'mystery') throw new Error('Expected forced mystery box')
    assert.equal(box.reward, reward)
    assert.equal(box.saberColor, reward === 'sword' ? saberColor : undefined)
    box.z = -.5
    game.jump = .3
    advanceGame(game, 0, () => .5, { spawn: false })
    if (reward === 'bonus') {
      assert.equal(game.lives, mode === 'survival' ? 6 : 5)
      assert.equal(game.coins, mode === 'free-run' ? 1 : 0)
    } else {
      assert.equal(game.ability?.kind, reward)
      if (game.ability?.kind === 'sword') assert.equal(game.ability.saberColor, saberColor)
    }
  }
})

test('live changes affect only new waves and disabling overrides immediately restores normal spawning', () => {
  const game = running()
  const defaults = createSpawnOverrides()
  advanceGame(game, 0, () => .5, { spawnOverrides: { ...defaults, lanes: [-1], kinds: ['block'] } })
  const first = game.items[0]
  const before = { ...first }
  game.nextSpawn = 0
  advanceGame(game, 0, () => .5, { spawnOverrides: { ...defaults, lanes: [1], kinds: ['mystery'], rewards: ['fireball'] } })
  assert.equal(game.items[0], first)
  assert.deepEqual(first, before)
  assert.equal(game.items[1].lane, 1)
  assert.equal(game.items[1].kind, 'mystery')
  game.nextSpawn = 0
  advanceGame(game, 0, () => .5)
  assert.equal(game.items.length, 6)
  assert.equal(game.items[2].kind, 'overhead')
  assert.equal(game.items[2].lane, 0)
  assert.equal(game.items.slice(3).filter(item => item.kind === 'coin').length, 3)
  assert.equal(new Set(game.items.map(item => item.id)).size, 6)
  assert.deepEqual(first, before)
})

test('debug course boxes share selected metadata across four independent multiplayer tracks and pickups', () => {
  const course = running()
  const players = createPlayers([0, 1, 2, 3], 'survival', 1, true)
  const spawnOverrides: SpawnOverrides = { lanes: [0], kinds: ['mystery'], rewards: ['sword'], saberColors: ['purple'] }
  advanceMultiplayer(course, players, 0, () => .5, spawnOverrides)
  const shared = course.items[0]
  for (const player of players) {
    assert.deepEqual(player.game.current.items, [shared])
    assert.notEqual(player.game.current.items[0], shared)
    player.game.current.items[0].z = -.5
    player.game.current.jump = .3
  }
  assert.equal(shared.z, -85)
  advanceMultiplayer(course, players, 0, () => .5, spawnOverrides)
  for (const player of players) {
    assert.equal(player.game.current.ability?.kind, 'sword')
    if (player.game.current.ability?.kind === 'sword') assert.equal(player.game.current.ability.saberColor, 'purple')
  }
  assert.notEqual(players[0].game.current.ability, players[1].game.current.ability)
  assert.equal(shared.hit, false)
})

test('empty or duplicate debug pools fail explicitly before mutating game state', () => {
  for (const key of ['lanes', 'kinds', 'rewards', 'saberColors'] as const) {
    const defaults = createSpawnOverrides()
    const game = running()
    const before = structuredClone(game)
    const empty = { ...defaults, [key]: [] }
    assert.throws(() => advanceGame(game, .05, () => .5, { spawnOverrides: empty }), RangeError)
    const duplicate = { ...defaults, [key]: [defaults[key][0], defaults[key][0]] }
    assert.throws(() => advanceGame(game, .05, () => .5, { spawnOverrides: duplicate }), RangeError)
    assert.deepEqual(game, before)
  }
})
