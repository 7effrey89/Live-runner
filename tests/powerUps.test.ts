import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceGame, hitObstacle, newGame, requestJump, scoreOf } from '../src/gameLogic.ts'
import type { Game, Item } from '../src/gameLogic.ts'
import { ABILITY_DURATION, abilityCountdown, attackWithAbility, BLASTER_INTERVAL, FIREBALL_INTERVAL, FIREBALL_RANGE, fireballHeight, grantMysteryReward, MYSTERY_REWARDS, SABER_COLORS, SWORD_RANGE, swingSword, throwFireball } from '../src/powerUps.ts'
import { advanceMultiplayer, createPlayers, keyboardControl, snapshotPlayers, stopPlayers } from '../src/multiplayer.ts'
import { jumpNow } from '../src/jumpGuidance.ts'

function running(mode: Game['mode'] = 'survival') {
  const game = newGame(mode, 2)
  game.phase = 'running'
  game.nextSpawn = 10000
  return game
}
const obstacle = (id = 0, z = -2, lane: -1 | 0 | 1 = 0): Item => ({ id, kind: 'block', lane, z, hit: false })
const box = (reward: typeof MYSTERY_REWARDS[number], z = -.5, lane: -1 | 0 | 1 = 0): Item =>
  ({ id: 100, kind: 'mystery', reward, lane, z, hit: false })

test('mystery boxes spawn as isolated waves with a reward selected once on the course', () => {
  for (const [index, reward] of MYSTERY_REWARDS.entries()) {
    const game = running()
    game.nextSpawn = 0
    let calls = 0
    advanceGame(game, 0, () => { calls++; return (index + .1) / MYSTERY_REWARDS.length })
    assert.equal(calls, reward === 'sword' ? 4 : 3)
    assert.equal(game.items[0].kind, 'mystery')
    assert.ok('reward' in game.items[0])
    assert.equal(game.items[0].reward, reward)
    assert.equal(game.items.filter(item => item.kind === 'mystery').length, 1)
    assert.equal(game.nextMystery, 140)
    game.nextSpawn = 0
    advanceGame(game, .01, () => .5)
    assert.equal(game.items.filter(item => item.kind === 'mystery').length, 1)
  }
})

test('a box requires actual airborne height, the correct lane, and no recovery; missing it never hurts', () => {
  for (const condition of ['ground', 'takeoff', 'lane', 'recovery', 'jump'] as const) {
    const game = running()
    game.items = [box('sword')]
    if (condition !== 'ground') requestJump(game)
    if (condition !== 'ground' && condition !== 'takeoff') game.jump = .3
    if (condition === 'lane') game.lane = 1
    if (condition === 'recovery') game.recovery = .5
    advanceGame(game, 0)
    assert.equal(game.ability?.kind, condition === 'jump' ? 'sword' : undefined)
    assert.equal(game.items.length, condition === 'jump' ? 0 : 1)
    assert.equal(game.lives, 5)
    assert.equal(game.penalty, 0)
  }
})

test('each reward is applied once, and bonuses give an extra life even at full health or exactly one coin', () => {
  for (const mode of ['survival', 'free-run'] as const) {
    for (const reward of MYSTERY_REWARDS) {
      const game = running(mode)
      game.items = [box(reward)]
      game.jump = .3
      advanceGame(game, 0)
      advanceGame(game, 0)
      assert.equal(game.lives, reward === 'bonus' && mode === 'survival' ? 6 : 5)
      assert.equal(game.coins, reward === 'bonus' && mode === 'free-run' ? 1 : 0)
      assert.equal(game.ability?.kind, reward === 'bonus' ? undefined : reward)
      assert.equal(game.pickup?.kind, reward === 'bonus' ? mode === 'survival' ? 'life' : 'coin' : reward)
    }
  }
})

test('invisibility bypasses every hazard and pending contact without penalties, then expires', () => {
  for (const mode of ['survival', 'free-run'] as const) {
    const game = running(mode)
    game.distance = 500
    const score = scoreOf(game)
    grantMysteryReward(game, 'invisibility')
    game.items = (['barrier', 'overhead', 'block'] as const).map((kind, id) => ({ ...obstacle(id, -.5), kind }))
    game.items[0].jumpContactAt = 0
    advanceGame(game, 0)
    assert.ok(game.items.every(item => item.hit && !item.fall && item.jumpContactAt === undefined))
    assert.equal(game.lives, 5)
    assert.equal(scoreOf(game), score)
    assert.equal(game.recovery, 0)
    const direct = obstacle(10, 0)
    assert.equal(hitObstacle(game, direct), false)
    assert.equal(direct.fall, undefined)
    advanceGame(game, ABILITY_DURATION)
    assert.equal(game.ability, undefined)
    assert.equal(hitObstacle(game, obstacle(11, 0)), true)
    assert.equal(game.lives, mode === 'survival' ? 4 : 5)
  }
})

test('laser sword requires a swing and destroys only nearby obstacles on its own track, not pickups', () => {
  const game = running()
  grantMysteryReward(game, 'sword')
  game.items = [obstacle(0, -3), obstacle(1, -SWORD_RANGE - .1), obstacle(2, -2, 1),
    obstacle(3, 2), box('bonus', -2), { id: 101, kind: 'coin', lane: 0, z: -2, hit: false }]
  advanceGame(game, 0)
  assert.ok(game.items.every(item => !item.hit))
  assert.equal(swingSword(game), true)
  assert.equal(swingSword(game), false)
  advanceGame(game, 0)
  assert.ok(game.items[0].fall)
  assert.ok(game.items.slice(1).every(item => !item.hit))
  assert.equal(game.lives, 5)
  advanceGame(game, .36)
  assert.equal(swingSword(game), true)
  advanceGame(game, ABILITY_DURATION)
  assert.equal(swingSword(game), false)
})

test('automatic blaster selects the nearest forward obstacle, honors range and firing interval, and leaves coins/boxes intact', () => {
  const game = running()
  grantMysteryReward(game, 'blaster')
  game.items = [obstacle(0, -20), obstacle(1, -8), obstacle(2, -40), obstacle(3, -5, 1), obstacle(4, 2),
    box('invisibility', -2), { id: 101, kind: 'coin', lane: 0, z: -2, hit: false }]
  advanceGame(game, 0)
  assert.ok(game.items[1].fall)
  assert.equal(game.ability?.beam?.distance, 8)
  assert.equal(game.items[0].hit, false)
  advanceGame(game, BLASTER_INTERVAL - .01)
  assert.equal(game.items[0].hit, false)
  advanceGame(game, .011)
  assert.ok(game.items[0].fall)
  assert.ok(game.items.slice(2).every(item => !item.hit))
  assert.equal(game.coins, 0)
})

test('an expired or recovering ability cannot fire, swing, or protect against a collision', () => {
  for (const kind of ['invisibility', 'sword', 'blaster'] as const) {
    const game = running()
    grantMysteryReward(game, kind)
    game.ability!.remaining = .01
    game.items = [obstacle(0, -.5)]
    advanceGame(game, .02)
    assert.equal(game.ability, undefined)
    assert.equal(game.lives, 4)
    const recovering = running()
    grantMysteryReward(recovering, kind)
    recovering.recovery = 1
    recovering.items = [obstacle()]
    assert.equal(swingSword(recovering), false)
    advanceGame(recovering, .1)
    assert.equal(recovering.items[0].hit, false)
  }
})

test('new abilities replace rather than stack, bonuses retain the current ability, and end/restart removes effects', () => {
  const game = running()
  grantMysteryReward(game, 'sword')
  swingSword(game)
  grantMysteryReward(game, 'invisibility')
  assert.deepEqual(game.ability, { kind: 'invisibility', remaining: 10, swing: 0, cooldown: 0 })
  grantMysteryReward(game, 'bonus')
  assert.equal(game.ability?.kind, 'invisibility')
  game.phase = 'over'
  advanceGame(game, 0)
  assert.equal(game.ability, undefined)
  assert.equal(game.pickup, undefined)
  assert.equal(grantMysteryReward(game, 'sword'), false)
  assert.equal(newGame().ability, undefined)
})

test('the countdown shows exactly 3, 2, 1 during the last three seconds and disappears on expiry', () => {
  const game = running()
  grantMysteryReward(game, 'sword')
  for (const [remaining, expected] of [[10, undefined], [3.001, undefined], [3, 3], [2.001, 3], [2, 2], [1, 1], [.001, 1], [0, undefined]] as const) {
    game.ability!.remaining = remaining
    assert.equal(abilityCountdown(game.ability), expected)
  }
  assert.equal(abilityCountdown(undefined), undefined)
})

test('shared boxes, destruction, bonus lives, and ability timers stay independent for all four players', () => {
  const course = running()
  course.items = [box('sword')]
  course.nextId = 101
  const players = createPlayers([0, 1, 2, 3], 'survival', 2, true)
  players[0].game.current.jump = .3
  players[2].game.current.jump = .3
  advanceMultiplayer(course, players, 0)
  assert.deepEqual(players.map(player => player.game.current.ability?.kind), ['sword', undefined, 'sword', undefined])
  assert.equal(course.items[0].hit, false)
  const first = players[0].game.current
  const third = players[2].game.current
  assert.notEqual(first.ability, third.ability)
  first.items.push(obstacle(102, -2))
  third.items.push(obstacle(102, -2))
  swingSword(first)
  const snapshot = snapshotPlayers(players)
  advanceMultiplayer(course, players, .01)
  assert.ok(first.items.find(item => item.id === 102)?.fall)
  assert.equal(third.items.find(item => item.id === 102)?.fall, undefined)
  assert.equal(snapshot[0].game.ability?.remaining, 10)
  assert.equal(first.ability?.remaining, 9.99)
  stopPlayers(players)
  assert.ok(players.every(player => !player.game.current.ability && !player.game.current.pickup))
})

test('assistance recommends jumping into a mystery box and keyboard players have independent sword keys', () => {
  const game = running()
  game.items = [box('sword', -5)]
  assert.equal(jumpNow(game), true)
  for (const [key, player] of [['x', 0], ['e', 1], ['o', 2], ['y', 3]] as const) {
    assert.deepEqual(keyboardControl(key, 4), { player, action: 'attack' })
  }
  assert.deepEqual(keyboardControl('e', 1), { player: 0, action: 'attack' })
})

test('all four saber colors are selected once and remain stable during swings and frames', () => {
  for (const [index, color] of SABER_COLORS.entries()) {
    const game = running()
    let calls = 0
    grantMysteryReward(game, 'sword', undefined, () => { calls++; return index / SABER_COLORS.length })
    assert.equal(calls, 1)
    assert.equal(game.ability?.kind === 'sword' && game.ability.saberColor, color)
    assert.equal(attackWithAbility(game), 'sword')
    for (let frame = 0; frame < 5; frame++) advanceGame(game, .05)
    assert.equal(game.ability?.kind === 'sword' && game.ability.saberColor, color)
    assert.equal(calls, 1)
  }
})

test('a shared saber box selects one color for every collector without shared mutable ability state', () => {
  const course = running()
  course.nextSpawn = 0
  const draws = [.5, .25, .75, .5]
  advanceGame(course, 0, () => {
    const draw = draws.shift()
    assert.ok(draw !== undefined)
    return draw
  })
  const item = course.items.find(item => item.kind === 'mystery')
  assert.equal(item?.kind === 'mystery' && item.saberColor, 'red')
  assert.ok(item)
  item.z = -.5
  const players = createPlayers([0, 1], 'survival', 2, true)
  players.forEach(player => { player.game.current.jump = .3 })
  advanceMultiplayer(course, players, 0)
  for (const player of players) assert.equal(player.game.current.ability?.kind === 'sword' && player.game.current.ability.saberColor, 'red')
  assert.notEqual(players[0].game.current.ability, players[1].game.current.ability)
})

test('fireballs require a deliberate attack and cooldown, remember either throwing hand, and have unique IDs', () => {
  const game = running()
  grantMysteryReward(game, 'fireball')
  advanceGame(game, .1)
  assert.equal(game.ability?.kind === 'fireball' && game.ability.fireballs.length, 0)
  assert.equal(attackWithAbility(game, 'left'), 'fireball')
  assert.equal(throwFireball(game, 'right'), false)
  advanceGame(game, FIREBALL_INTERVAL + .01)
  assert.equal(throwFireball(game, 'right'), true)
  assert.ok(game.ability?.kind === 'fireball')
  assert.deepEqual(game.ability.fireballs.map(ball => ball.hand), ['left', 'right'])
  assert.deepEqual(game.ability.fireballs.map(ball => ball.id), [0, 1])
  assert.equal(fireballHeight(game.ability.fireballs[1]), 1.1)
})

test('swept fireballs hit the nearest obstacle on their original lane without harming pickups or another lane', () => {
  const game = running()
  grantMysteryReward(game, 'fireball')
  game.items = [obstacle(0, -1.5), obstacle(1, -8), obstacle(2, -1, 1), box('bonus', -2),
    { id: 101, kind: 'coin', lane: 0, z: -2, hit: false }]
  throwFireball(game)
  game.lane = -1
  const sounds = advanceGame(game, .05)
  assert.ok(sounds.includes('abilityHit'))
  assert.ok(game.items[0].fall)
  assert.ok(game.items.slice(1).every(item => !item.hit))
  assert.equal(game.ability?.kind === 'fireball' && game.ability.fireballs.length, 0)
  assert.equal(game.lives, 5)
})

test('fireballs bounce above the ground, expire at range/lifetime, and cannot survive replacement or ability expiry', () => {
  const game = running()
  grantMysteryReward(game, 'fireball')
  throwFireball(game)
  assert.ok(game.ability?.kind === 'fireball')
  const ball = game.ability.fireballs[0]
  for (let age = .2; age < 2; age += .01) {
    const height = fireballHeight({ ...ball, age })
    assert.ok(height >= .3 && height <= 1.201)
  }
  ball.z = -FIREBALL_RANGE
  advanceGame(game, .05)
  assert.equal(game.ability.fireballs.length, 0)
  game.ability.cooldown = 0
  throwFireball(game)
  advanceGame(game, 2)
  assert.equal(game.ability.fireballs.length, 0)
  game.ability.cooldown = 0
  throwFireball(game)
  grantMysteryReward(game, 'sword', 'blue')
  assert.equal(game.ability?.kind, 'sword')
  grantMysteryReward(game, 'fireball')
  throwFireball(game)
  game.ability!.remaining = .01
  assert.deepEqual(advanceGame(game, .02), ['expire'])
  assert.equal(game.ability, undefined)
})

test('fireball snapshots and destruction are independent for multiple players', () => {
  const course = running()
  const players = createPlayers([0, 1], 'survival', 2, true)
  players.forEach(player => grantMysteryReward(player.game.current, 'fireball'))
  const first = players[0].game.current
  const second = players[1].game.current
  first.items = [obstacle(0, -1.5)]
  second.items = [obstacle(0, -1.5)]
  second.lane = 1
  throwFireball(first, 'left')
  const snapshot = snapshotPlayers(players)
  advanceMultiplayer(course, players, .05)
  assert.ok(first.items[0].fall)
  assert.equal(second.items[0].fall, undefined)
  assert.ok(snapshot[0].game.ability?.kind === 'fireball')
  assert.equal(snapshot[0].game.ability.fireballs[0].z, 0)
  assert.equal(second.ability?.kind === 'fireball' && second.ability.fireballs.length, 0)
})

test('ability pickup, automatic shots, countdown crossings, and expiry emit distinct sound cues once', () => {
  const game = running()
  game.items = [box('blaster')]
  game.jump = .3
  assert.deepEqual(advanceGame(game, 0), ['powerup'])
  game.items = [obstacle(0, -8)]
  assert.deepEqual(advanceGame(game, 0), ['blaster', 'abilityHit'])
  game.items = []
  game.ability!.remaining = 3.1
  assert.deepEqual(advanceGame(game, .11), ['countdown'])
  assert.deepEqual(advanceGame(game, .1), [])
  assert.deepEqual(advanceGame(game, 1), ['countdown'])
  assert.deepEqual(advanceGame(game, 1), ['countdown'])
  assert.deepEqual(advanceGame(game, 1), ['expire'])
  assert.deepEqual(advanceGame(game, 0), [])
})
