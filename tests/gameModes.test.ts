import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceGame, fallOpacity, hitObstacle, newGame, recoveryPose, requestJump, scoreOf, speedAtDistance, FALL_DURATION, RECOVERY_DURATION, MIN_RUN_SPEED, MAX_RUN_SPEED } from '../src/gameLogic.ts'
import { JUMP_DURATION, JUMP_BUFFER_DURATION } from '../src/runnerMotion.ts'
import type { Item } from '../src/gameLogic.ts'
import { CHARACTERS, cycleCharacter } from '../src/characters.ts'
import { createCrossedArmsCalibrator, crossedArmsState } from '../src/crossedArms.ts'
import { createBodyTracker, getBodyPosition } from '../src/bodyTracking.ts'
import type { BodyPoint } from '../src/bodyTracking.ts'
import { createDualDwellController, getHandPointers } from '../src/handPointer.ts'
import type { HandPointer } from '../src/handPointer.ts'

const obstacle = (id = 0): Item => ({ id, kind: 'block', lane: 0, z: -0.5, hit: false })
function crossed(): BodyPoint[] {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }))
  for (const [index, x, y] of [[11, .65, .4], [12, .35, .4], [13, .75, .62], [14, .25, .62], [15, .35, .45], [16, .65, .45]]) {
    pose[index] = { x, y, visibility: 1 }
  }
  return pose
}
const pointer = (hand: 'left' | 'right', x = 100): HandPointer => ({ hand, x, y: 100 })

test('speed progression and speedometer limits use the same minimum and maximum', () => {
  assert.equal(newGame().speed, MIN_RUN_SPEED)
  assert.equal(speedAtDistance(0), 15)
  assert.equal(speedAtDistance(1440), 23)
  assert.equal(speedAtDistance(2880), MAX_RUN_SPEED)
  assert.equal(speedAtDistance(10000), 31)
  for (const distance of [0, 1440, 2880, 10000]) {
    const game = newGame(); game.phase = 'running'; game.distance = distance
    advanceGame(game, .016)
    assert.equal(game.speed, speedAtDistance(distance))
  }
})

test('jump requests start immediately or buffer once until landing within 100ms', () => {
  const game = newGame(); game.phase = 'running'; game.nextSpawn = 10000
  assert.equal(requestJump(game), true)
  assert.equal(game.jump, JUMP_DURATION)
  assert.equal(game.jumpId, 1)
  game.jump = .06
  assert.equal(requestJump(game), false)
  assert.equal(game.jumpBuffer, JUMP_BUFFER_DURATION)
  assert.deepEqual(advanceGame(game, .03), [])
  assert.deepEqual(advanceGame(game, .04), ['jump'])
  assert.ok(Math.abs(game.jump - (JUMP_DURATION - .01)) < 1e-9)
  assert.equal(game.jumpBuffer, 0)
  assert.equal(game.jumpId, 2)
  assert.deepEqual(advanceGame(game, .02), [])
})

test('expired buffers do not fire, and impacts or inactive phases cannot queue ghost jumps', () => {
  const game = newGame(); game.phase = 'running'; game.nextSpawn = 10000; game.jump = .3
  requestJump(game)
  advanceGame(game, .11)
  assert.equal(game.jumpBuffer, 0)
  assert.deepEqual(advanceGame(game, .2), [])
  requestJump(game)
  hitObstacle(game, obstacle())
  assert.equal(game.jumpBuffer, 0)
  assert.equal(requestJump(game), false)
  game.phase = 'over'; game.recovery = 0
  assert.equal(requestJump(game), false)
  assert.equal(requestJump(newGame()), false)
})

test('buffered jumps survive a long render frame only when landing precedes expiry', () => {
  const game = newGame(); game.phase = 'running'; game.nextSpawn = 10000; game.jump = .04
  requestJump(game)
  assert.deepEqual(advanceGame(game, .12), ['jump'])
  assert.ok(Math.abs(game.jump - .4) < 1e-9)
})

test('jump buffering tolerates an imminent slide release but never overrides a held crouch', () => {
  const game = newGame(); game.phase = 'running'; game.nextSpawn = 10000; game.slide = .04
  requestJump(game)
  assert.deepEqual(advanceGame(game, .016), [])
  assert.deepEqual(advanceGame(game, .03), ['jump'])
  assert.ok(game.jump > .47)
  game.jump = 0; game.slide = .8
  requestJump(game)
  for (let i = 0; i < 10; i++) {
    game.slide = .8
    assert.deepEqual(advanceGame(game, .016), [])
  }
  assert.equal(game.jump, 0)
  assert.equal(game.jumpBuffer, 0)
})

test('an intentional late takeoff clears a barrier that the previous slow arc would hit', () => {
  const game = newGame('survival'); game.phase = 'running'; game.nextSpawn = 10000
  game.items = [{ ...obstacle(), kind: 'barrier', z: -2 }]
  requestJump(game)
  for (let i = 0; i < 8; i++) advanceGame(game, 1 / 60)
  assert.equal(game.lives, 5)
  assert.equal(game.items[0].hit, true)
  assert.equal(game.items[0].fall, undefined)
})

test('free run subtracts 100 points once and never ends on collisions', () => {
  const game = newGame()
  game.phase = 'running'; game.distance = 400; game.coins = 2
  const item = obstacle()
  assert.equal(hitObstacle(game, item), true)
  assert.equal(scoreOf(game), 400)
  assert.equal(game.phase, 'running')
  assert.equal(game.coins, 2)
  assert.equal(game.impact, 'fall')
  assert.equal(hitObstacle(game, item), false)
  assert.equal(hitObstacle(game, obstacle(1)), false)
  assert.equal(scoreOf(game), 400)
})

test('free run clamps losses to the current score without creating future score debt', () => {
  const game = newGame(); game.phase = 'running'; game.distance = 20
  hitObstacle(game, obstacle())
  assert.equal(game.lastPenalty, 20)
  assert.equal(scoreOf(game), 0)
  game.distance = 25
  assert.equal(scoreOf(game), 5)
})

test('survival consumes one heart per distinct mistake and ends only at zero', () => {
  const game = newGame('survival'); game.phase = 'running'
  for (let i = 0; i < 5; i++) {
    game.recovery = 0
    assert.equal(hitObstacle(game, obstacle(i)), true)
    assert.equal(game.lives, 4 - i)
    assert.equal(game.phase, i < 4 ? 'running' : 'over')
  }
  assert.equal(hitObstacle(game, obstacle(6)), false)
  assert.equal(game.lives, 0)
  assert.equal(game.penalty, 0)
  assert.equal(newGame('survival').lives, 5)
})

test('simultaneous obstacles cause one mistake, topple together, and do not block coin collection during recovery', () => {
  const game = newGame('survival'); game.phase = 'running'; game.nextSpawn = 10000
  game.items = [obstacle(0), obstacle(1)]
  assert.deepEqual(advanceGame(game, .016), ['crash'])
  assert.equal(game.lives, 4)
  assert.ok(game.items.every(item => item.fall))
  game.items.push({ id: 2, kind: 'coin', lane: 0, z: -.5, hit: false })
  assert.deepEqual(advanceGame(game, .016), ['coin'])
  assert.equal(game.coins, 1)
  assert.equal(game.lives, 4)
})

test('short jumps and held crouches still clear the correct obstacles', () => {
  for (const [kind, jump, slide] of [['barrier', .24, 0], ['overhead', 0, .8]] as const) {
    const game = newGame('survival'); game.phase = 'running'; game.nextSpawn = 10000
    game.jump = jump; game.slide = slide; game.items = [{ ...obstacle(), kind }]
    assert.deepEqual(advanceGame(game, .016), [])
    assert.equal(game.lives, 5)
    assert.equal(game.items[0].fall, undefined)
  }
})

test('fallen obstacles bounce above ground, topple, fade monotonically, and expire even after game over', () => {
  const game = newGame('survival'); game.phase = 'running'; game.nextSpawn = 10000
  const item = obstacle(); game.items = [item]; hitObstacle(game, item)
  game.phase = 'over'
  for (let i = 0; i < 90; i++) {
    advanceGame(game, 1 / 60)
    assert.ok(item.fall!.y >= 0)
  }
  assert.ok(item.fall!.angle > 1.3)
  assert.ok(Math.abs(item.fall!.x) > 1)
  assert.equal(game.distance, 0)
  assert.equal(fallOpacity(0), 1)
  assert.equal(fallOpacity(1), 1)
  assert.ok(fallOpacity(2) < fallOpacity(1.5))
  assert.equal(fallOpacity(FALL_DURATION), 0)
  advanceGame(game, 2)
  assert.equal(game.items.length, 0)
  assert.equal(game.recovery, 0)
})

test('fall and stumble reactions recover smoothly and do not remain tilted', () => {
  assert.equal(recoveryPose(RECOVERY_DURATION, 'fall').pitch, 0)
  assert.ok(recoveryPose(1, 'fall').pitch < recoveryPose(1, 'stumble').pitch)
  assert.deepEqual(recoveryPose(0, 'fall'), { pitch: 0, roll: 0, lift: 0 })
})

test('character arrows wrap through all four skins', () => {
  assert.equal(cycleCharacter(CHARACTERS[0].id, -1), CHARACTERS[3].id)
  let current = CHARACTERS[0].id as typeof CHARACTERS[number]['id']
  for (let i = 0; i < 4; i++) current = cycleCharacter(current, 1)
  assert.equal(current, CHARACTERS[0].id)
})

test('cross calibration requires intersecting forearms, not touching or merely swapping wrists', () => {
  const pose = crossed()
  assert.equal(crossedArmsState(pose), 'crossed')
  pose[15].x = pose[16].x = .5
  assert.equal(crossedArmsState(pose), 'uncrossed')
  pose[13].visibility = 0
  assert.equal(crossedArmsState(pose), 'lost')
})

test('cross captures neutral after exactly one second and latches until visible uncrossing', () => {
  const detector = createCrossedArmsCalibrator(), pose = crossed()
  for (let t = 0; t <= 950; t += 50) assert.equal(detector.update(pose, t).neutral, undefined)
  assert.equal(detector.update(pose, 999).neutral, undefined)
  assert.deepEqual(detector.update(pose, 1000).neutral, getBodyPosition(pose))
  assert.equal(detector.update(pose, 1100).neutral, undefined)
  detector.update([], 1200)
  assert.equal(detector.update(pose, 1300).neutral, undefined)
  const uncrossed = crossed(); uncrossed[15].x = .8; uncrossed[16].x = .2
  detector.update(uncrossed, 1400)
  for (let t = 1500; t < 2500; t += 50) assert.equal(detector.update(pose, t).neutral, undefined)
  assert.ok(detector.update(pose, 2500).neutral)
})

test('cross calibration restarts after camera gaps or shoulder movement', () => {
  const detector = createCrossedArmsCalibrator(), pose = crossed()
  for (let t = 0; t <= 500; t += 100) detector.update(pose, t)
  assert.equal(detector.update(pose, 800).progress, 0)
  pose.forEach(point => { point.x += .1 })
  assert.equal(detector.update(pose, 900).progress, 0)
  for (let t = 1000; t < 1900; t += 100) assert.equal(detector.update(pose, t).neutral, undefined)
  assert.ok(detector.update(pose, 1900).neutral)
})

test('captured neutral applies immediately and crossed arms suppress movement gestures', () => {
  const tracker = createBodyTracker(), pose = crossed()
  const position = getBodyPosition(pose)!
  tracker.captureNeutral(position, 1000)
  const motion = tracker.update(pose, 1000, 4 / 3, true)
  assert.equal(motion.status, 'tracking')
  assert.equal(motion.height, 0)
  assert.equal(motion.shift, 0)
  assert.equal(motion.jump, false)
  assert.equal(motion.crouching, false)
  assert.throws(() => tracker.captureNeutral({ x: NaN, y: .5, scale: .3 }, 0), RangeError)
})

test('both wrists independently map to mirrored button cursors without needing shoulders', () => {
  const pose = crossed(); pose[11].visibility = pose[12].visibility = 0
  const hands = getHandPointers(pose)
  assert.deepEqual(hands.map(hand => hand.hand), ['left', 'right'])
  assert.ok(hands[0].x > hands[1].x)
})

test('two hands can dwell on different buttons independently', () => {
  const dwell = createDualDwellController<string>()
  const entries = [{ pointer: pointer('left'), target: 'a' }, { pointer: pointer('right', 300), target: 'b' }]
  for (const t of [0, 200, 400]) assert.deepEqual(dwell.update(entries, t).clicks, [])
  assert.deepEqual(dwell.update(entries, 600).clicks, ['a', 'b'])
  assert.deepEqual(dwell.update(entries, 800).clicks, [])
})

test('two hands over one button click once, retaining the latch through hand loss until both leave', () => {
  const dwell = createDualDwellController<string>()
  const both = [{ pointer: pointer('left'), target: 'a' }, { pointer: pointer('right', 110), target: 'a' }]
  for (const t of [0, 200, 400]) dwell.update(both, t)
  assert.deepEqual(dwell.update(both, 600).clicks, ['a'])
  dwell.update([{ pointer: pointer('left', 300), target: undefined }, both[1]], 800)
  dwell.update([], 900)
  assert.deepEqual(dwell.update(both, 1000).clicks, [])
  for (const t of [1200, 1400, 1600]) assert.deepEqual(dwell.update(both, t).clicks, [])
  dwell.update(both.map(entry => ({ ...entry, target: undefined })), 1800)
  for (const t of [2000, 2200, 2400]) dwell.update(both, t)
  assert.deepEqual(dwell.update(both, 2600).clicks, ['a'])
})

test('temporarily disabled character arrows do not retrigger a held hand after assets load', () => {
  const dwell = createDualDwellController<string>()
  const entry = { pointer: pointer('left'), target: 'next', enabled: true }
  for (const t of [0, 200, 400]) dwell.update([entry], t)
  assert.deepEqual(dwell.update([entry], 600).clicks, ['next'])
  dwell.update([{ ...entry, enabled: false }], 700)
  for (const t of [800, 1000, 1200, 1400]) assert.deepEqual(dwell.update([entry], t).clicks, [])
  dwell.update([{ ...entry, target: undefined }], 1600)
  for (const t of [1800, 2000, 2200]) dwell.update([entry], t)
  assert.deepEqual(dwell.update([entry], 2400).clicks, ['next'])
})
