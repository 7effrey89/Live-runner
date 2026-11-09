import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlayerRoster } from '../src/playerTracking.ts'
import { advanceMultiplayer, avatarScale, createPlayers, keyboardControl, playerOffset, setPlayerDifficulty, snapshotPlayers, stopPlayers } from '../src/multiplayer.ts'
import { advanceGame, hitObstacle, newGame, requestJump, scoreOf } from '../src/gameLogic.ts'
import type { BodyPoint } from '../src/bodyTracking.ts'

function pose(x: number, y = .4): BodyPoint[] {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }))
  points[11] = { x: x + .025, y, visibility: 1 }
  points[12] = { x: x - .025, y, visibility: 1 }
  return points
}
function enroll(roster: ReturnType<typeof createPlayerRoster>, people: BodyPoint[][]) {
  for (let time = 0; time < 600; time += 50) assert.equal(roster.update(people, time).length, 0)
  return roster.update(people, 600)
}
function course(mode: 'free-run' | 'survival' = 'survival') {
  const game = newGame(mode, 2)
  game.phase = 'running'
  game.nextSpawn = 10000
  return game
}

test('up to four people enroll only after sustained visibility and get stable left-to-right IDs', () => {
  const roster = createPlayerRoster()
  const people = [.8, .6, .4, .2].map(x => pose(x))
  const enrolled = enroll(roster, people)
  assert.deepEqual(enrolled.map(player => player.id), [0, 1, 2, 3])
  assert.deepEqual(enrolled.map(player => player.poseIndex), [0, 1, 2, 3])
  const reversed = roster.update([...people].reverse(), 650)
  assert.deepEqual(reversed.map(player => player.poseIndex), [3, 2, 1, 0])
  const fifth = roster.update([...people, pose(.05)], 1300)
  assert.equal(fifth.length, 4)
})

test('the startup roster locks, rejects new people, and preserves slots through tracking loss', () => {
  const roster = createPlayerRoster()
  const people = [pose(.8), pose(.3)]
  enroll(roster, people)
  assert.deepEqual(roster.lock(600), [0, 1])
  for (let time = 650; time < 1800; time += 50) {
    const tracked = roster.update([people[0], pose(.05)], time)
    assert.deepEqual(tracked.map(player => player.id), [0, 1])
    assert.equal(tracked[0].poseIndex, 0)
    assert.equal(tracked[1].poseIndex, undefined)
  }
  const restored = roster.update([people[1], people[0]], 1900)
  assert.deepEqual(restored.map(player => player.poseIndex), [1, 0])
  roster.update([], 10000)
  assert.equal(roster.update(people, 10100).length, 2)
})

test('ambiguous overlapping people are not arbitrarily assigned another controller', () => {
  const roster = createPlayerRoster()
  enroll(roster, [pose(.54), pose(.46)])
  roster.lock(600)
  const overlap = roster.update([pose(.5), pose(.5)], 650)
  assert.ok(overlap.every(player => player.poseIndex === undefined))
})

test('equally plausible new detections cannot take over a locked player by detection order', () => {
  const roster = createPlayerRoster()
  enroll(roster, [pose(.5)])
  roster.lock(600)
  assert.equal(roster.update([pose(.49), pose(.51)], 650)[0].poseIndex, undefined)
  assert.equal(roster.update([pose(.51), pose(.49)], 700)[0].poseIndex, undefined)
})

test('enrollment requires at least eight fresh samples as well as 600ms', () => {
  const roster = createPlayerRoster()
  for (let time = 0; time <= 600; time += 100) assert.equal(roster.update([pose(.8)], time).length, 0)
  assert.equal(roster.update([pose(.8)], 650).length, 1)
})

test('people may join again in the next setup, and reset clears all previous identities', () => {
  const roster = createPlayerRoster()
  enroll(roster, [pose(.8)])
  roster.lock(600)
  for (let time = 650; time <= 1400; time += 50) assert.equal(roster.update([pose(.8), pose(.3)], time).length, 1)
  roster.unlock()
  for (let time = 1450; time < 2050; time += 50) roster.update([pose(.8), pose(.3)], time)
  assert.equal(roster.update([pose(.8), pose(.3)], 2050).length, 2)
  roster.reset()
  assert.equal(roster.update([pose(.8)], 2100).length, 0)
  roster.lock(2100, [0])
  assert.equal(roster.update([pose(.8), pose(.3)], 10000).length, 0)
})

test('short transient detections and invalid shoulders do not add lobby avatars', () => {
  const roster = createPlayerRoster()
  roster.update([pose(.8)], 0)
  roster.update([], 250)
  for (let time = 300; time < 900; time += 50) assert.equal(roster.update([pose(.8)], time).length, 0)
  assert.equal(roster.update([pose(.8)], 900).length, 1)
  const invalid = pose(.3)
  invalid[11].visibility = 0
  assert.equal(roster.update([pose(.8), invalid], 1500).length, 1)
})

test('reusing a departed lobby slot exposes a fresh enrollment so calibration is not inherited', () => {
  const roster = createPlayerRoster()
  const people = [.8, .6, .4, .2].map(x => pose(x))
  const original = enroll(roster, people)
  let latest = original
  for (let time = 650; time <= 3200; time += 50) latest = roster.update([...people.slice(0, 3), pose(.05)], time)
  assert.deepEqual(latest.map(player => player.id), [0, 1, 2, 3])
  assert.equal(latest[0].enrolledAt, original[0].enrolledAt)
  assert.ok(latest[3].enrolledAt > original[3].enrolledAt)
  assert.equal(latest[3].poseIndex, 3)
})

test('four players sharing one lane have independent successful jumps, collisions, and recovery', () => {
  const game = course()
  game.distance = 100
  game.items = [{ id: 0, kind: 'barrier', lane: 0, z: -.5, hit: false }]
  game.nextId = 1
  const players = createPlayers([0, 1, 2, 3], 'survival', 2, true)
  players[0].game.current.jump = .24
  players[2].game.current.lane = 1
  players[3].game.current.jump = .24
  assert.deepEqual(advanceMultiplayer(game, players, .016), ['crash'])
  assert.deepEqual(players.map(player => player.game.current.lives), [5, 4, 5, 5])
  assert.equal(players[0].game.current.items[0].fall, undefined)
  assert.ok(players[1].game.current.items[0].fall)
  assert.equal(players[3].game.current.items[0].fall, undefined)
  assert.equal(game.items[0].hit, false)
  assert.notEqual(players[0].game.current.items[0], players[1].game.current.items[0])
  assert.ok(players.every(player => player.game.current.distance === game.distance))
})

test('each player collects their own stars without stealing or respawning a teammate pickup', () => {
  const game = course()
  game.items = [{ id: 0, kind: 'coin', lane: 0, z: -.5, hit: false }]
  game.nextId = 1
  const players = createPlayers([0, 1, 2, 3], 'survival', 2, true)
  assert.deepEqual(advanceMultiplayer(game, players, .016), ['coin'])
  assert.deepEqual(players.map(player => player.game.current.coins), [1, 1, 1, 1])
  advanceMultiplayer(game, players, .016)
  assert.deepEqual(players.map(player => player.game.current.coins), [1, 1, 1, 1])
})

test('one player sliding or making a buffered late jump cannot clear another player obstacle', () => {
  const overhead = course()
  overhead.items = [{ id: 0, kind: 'overhead', lane: 0, z: -.5, hit: false }]
  overhead.nextId = 1
  const sliders = createPlayers([0, 1], 'survival', 2, true)
  sliders[1].game.current.slide = .8
  advanceMultiplayer(overhead, sliders, .016)
  assert.deepEqual(sliders.map(player => player.game.current.lives), [4, 5])

  const barrier = course()
  barrier.difficulty = 1
  barrier.items = [{ id: 0, kind: 'barrier', lane: 0, z: -.5, hit: false }]
  barrier.nextId = 1
  const jumpers = createPlayers([0, 1], 'survival', 1, true)
  advanceMultiplayer(barrier, jumpers, .016)
  assert.deepEqual(jumpers.map(player => player.game.current.lives), [5, 5])
  requestJump(jumpers[1].game.current)
  for (let frame = 0; frame < 12; frame++) advanceMultiplayer(barrier, jumpers, .016)
  assert.deepEqual(jumpers.map(player => player.game.current.lives), [4, 5])
  assert.equal(jumpers[0].game.current.jumpId, 0)
  assert.equal(jumpers[1].game.current.jumpId, 1)
})

test('Free Run penalties apply only to the player who hits an obstacle', () => {
  const game = course('free-run')
  game.distance = 500
  game.items = [{ id: 0, kind: 'block', lane: 0, z: -.5, hit: false }]
  game.nextId = 1
  const players = createPlayers([0, 1], 'free-run', 2, true)
  players[1].game.current.lane = 1
  advanceMultiplayer(game, players, .016)
  assert.equal(players[0].game.current.penalty, 100)
  assert.equal(players[1].game.current.penalty, 0)
  assert.equal(scoreOf(players[1].game.current) - scoreOf(players[0].game.current), 100)
  assert.ok(players.every(player => player.game.current.phase === 'running'))
})

test('Survival continues for surviving players and ends only when the last player is out', () => {
  const game = course()
  game.distance = 200
  game.items = [{ id: 0, kind: 'block', lane: 0, z: -.5, hit: false }]
  game.nextId = 1
  const players = createPlayers([0, 1], 'survival', 2, true)
  players[0].game.current.lives = 1
  players[1].game.current.lane = 1
  advanceMultiplayer(game, players, .016)
  assert.equal(players[0].game.current.phase, 'over')
  const finalScore = scoreOf(players[0].game.current)
  advanceMultiplayer(game, players, .016)
  assert.equal(game.phase, 'running')
  assert.equal(scoreOf(players[0].game.current), finalScore)
  assert.ok(players[1].game.current.distance > players[0].game.current.distance)
  const survivor = players[1].game.current
  survivor.lives = 1
  hitObstacle(survivor, { id: 10, lane: 1, kind: 'block', z: 0, hit: false })
  advanceMultiplayer(game, players, .016)
  assert.equal(game.phase, 'over')
  assert.equal(game.items.length, 0)
})

test('course spawning runs once and all player tracks receive the same hazard IDs', () => {
  const game = course()
  game.nextSpawn = 0
  const players = createPlayers([0, 1, 2, 3], 'survival', 2, true)
  let calls = 0
  advanceMultiplayer(game, players, .016, () => { calls++; return .5 })
  assert.equal(calls, 3)
  assert.equal(game.items.length, 4)
  assert.ok(players.every(player => player.game.current.items.length === 4))
  assert.ok(players.every(player => player.game.current.items.every((item, index) => item.id === game.items[index].id && item.z === game.items[index].z)))
})

test('single-player shared-course simulation preserves existing collision score and input behavior', () => {
  const baseline = course('free-run')
  const shared = course('free-run')
  baseline.nextSpawn = 0
  shared.nextSpawn = 0
  const players = createPlayers([0], 'free-run', 2, true)
  for (let frame = 0; frame < 900; frame++) {
    if (frame % 100 === 0) {
      baseline.lane = (frame % 3 - 1) as -1 | 0 | 1
      players[0].game.current.lane = baseline.lane
    }
    if (frame % 83 === 0) { requestJump(baseline); requestJump(players[0].game.current) }
    advanceGame(baseline, 1 / 60, () => .5)
    advanceMultiplayer(shared, players, 1 / 60, () => .5)
    const player = players[0].game.current
    for (const key of ['distance', 'coins', 'penalty', 'lives', 'jump', 'jumpId', 'slide', 'recovery'] as const) assert.equal(player[key], baseline[key], `${key} at frame ${frame}`)
    assert.equal(player.items.length, baseline.items.length)
    player.items.forEach((item, index) => {
      const expected = baseline.items[index]
      assert.ok(Math.abs(item.z - expected.z) < 1e-9)
      assert.deepEqual({ ...item, z: 0 }, { ...expected, z: 0 })
    })
  }
})

test('a paused or unstarted course cannot advance an independently running player', () => {
  const game = newGame()
  const players = createPlayers([0], 'free-run', 1, true)
  advanceMultiplayer(game, players, .05)
  assert.equal(players[0].game.current.distance, 0)
  assert.equal(players[0].game.current.time, 0)
})

test('player layout, keyboard controls, snapshots and reset are independent and bounded', () => {
  for (let count = 1; count <= 4; count++) {
    const offsets = Array.from({ length: count }, (_, index) => playerOffset(index, count))
    assert.ok(offsets.every(offset => Math.abs(offset) + .95 / count < 1.25))
    assert.ok(Math.abs(offsets.reduce((a, b) => a + b, 0)) < 1e-9)
    assert.ok(avatarScale(count) > 0 && avatarScale(count) <= 1)
  }
  assert.deepEqual(keyboardControl('w', 1), { player: 0, action: 'jump' })
  assert.deepEqual(keyboardControl('w', 4), { player: 1, action: 'jump' })
  assert.deepEqual(keyboardControl('i', 4), { player: 2, action: 'jump' })
  assert.deepEqual(keyboardControl('t', 4), { player: 3, action: 'jump' })
  assert.deepEqual(keyboardControl('ArrowDown', 4), { player: 0, action: 'slide' })
  const players = createPlayers([0, 1], 'survival', 1, true)
  const snapshots = snapshotPlayers(players)
  setPlayerDifficulty(players, .5)
  assert.equal(snapshots[0].game.difficulty, 1)
  assert.equal(players[0].game.current.difficulty, .5)
  players[0].game.current.jump = .4
  assert.equal(players[1].game.current.jump, 0)
  stopPlayers(players)
  assert.ok(players.every(player => player.game.current.phase === 'over' && player.game.current.jump === 0))
  for (const ids of [[], [0, 0], [4], [0, 1, 2, 3, 4]]) assert.throws(() => createPlayers(ids), RangeError)
})
