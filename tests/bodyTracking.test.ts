import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBodyTracker, getBodyPosition, isVisiblePoint } from '../src/bodyTracking.ts'
import type { BodyPoint } from '../src/bodyTracking.ts'
import { advanceGame, newGame, requestJump } from '../src/gameLogic.ts'

function upperBody(x = 0.5, y = 0.4, width = 0.24): BodyPoint[] {
  const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
  pose[11] = { x: x - width / 2, y, visibility: 0.9 }
  pose[12] = { x: x + width / 2, y, visibility: 0.9 }
  pose[15] = { x: x - width / 2, y: y + 0.2, visibility: 0.9 }
  pose[16] = { x: x + width / 2, y: y + 0.2, visibility: 0.9 }
  return pose
}

function fullBody(shoulderHeight = 0, hipHeight = shoulderHeight, width = .24, aspect = 4 / 3) {
  const pose = upperBody(.5, .4 - shoulderHeight * width * aspect, width)
  pose[23] = { x: .5 - width / 3, y: .7 - hipHeight * width * aspect, visibility: .9 }
  pose[24] = { x: .5 + width / 3, y: .7 - hipHeight * width * aspect, visibility: .9 }
  return pose
}

function calibrated(width = 0.24, aspect = 4 / 3, step = 50, neutral = upperBody(.5, .4, width)) {
  const tracker = createBodyTracker()
  let time = 0
  const feed = (pose = neutral, duration = step) => {
    const results = []
    for (let elapsed = 0; elapsed < duration; elapsed += step) {
      time += step
      results.push(tracker.update(pose, time, aspect))
    }
    return results
  }
  feed(undefined, 1000)
  return { feed }
}

test('tracks shoulders without visible hips, knees, or ankles', () => {
  const position = getBodyPosition(upperBody())
  assert.ok(position)
  assert.equal(position.x, 0.5)
  assert.equal(position.y, 0.4)
  assert.ok(Math.abs(position.scale - 0.32) < 1e-10)
  assert.equal(getBodyPosition([]), undefined)
  const pose = upperBody()
  pose[11].visibility = 0.5
  assert.equal(getBodyPosition(pose), undefined)
})

test('rejects low-confidence, offscreen, and invalid overlay points', () => {
  assert.equal(isVisiblePoint({ x: 0.5, y: 0.5, visibility: 0.9 }), true)
  for (const point of [
    undefined, { x: 0.5, y: 0.5 }, { x: -0.1, y: 0.5, visibility: 1 },
    { x: 0.5, y: 1.1, visibility: 1 }, { x: NaN, y: 0.5, visibility: 1 },
  ]) assert.equal(isVisiblePoint(point), false)
})

test('calibration waits for sustained stillness rather than capturing the first frame', () => {
  const tracker = createBodyTracker()
  for (let time = 0; time < 1000; time += 50) {
    const motion = tracker.update(upperBody(0.5, time % 100 ? 0.5 : 0.4), time)
    assert.equal(motion.status, 'calibrating')
    assert.equal(motion.jump, false)
  }
  let motion = tracker.update(upperBody(), 1000)
  for (let time = 1050; time <= 1700; time += 50) motion = tracker.update(upperBody(), time)
  assert.equal(motion.status, 'tracking')
  assert.equal(motion.jump, false)
})

test('lane targets respond within two frames while preserving the neutral dead zone', () => {
  for (const [x, lane] of [[0.61, -1], [0.39, 1], [0.55, 0]] as const) {
    for (const step of [1000 / 60, 1000 / 30, 50]) {
      const { feed } = calibrated(0.24, 4 / 3, step)
      assert.equal(feed(upperBody(x), 2 * step).at(-1)?.lane, lane)
    }
  }
})

test('scaled jumps register within two frames at different distances and video aspect ratios', () => {
  for (const width of [0.12, 0.24, 0.36]) {
    for (const aspect of [4 / 3, 16 / 9]) {
      for (const step of [1000 / 60, 1000 / 30, 50]) {
        const { feed } = calibrated(width, aspect, step)
        const pose = upperBody(0.5, 0.4 - width * aspect * 0.30, width)
        const motions = feed(pose, 500)
        const first = motions.findIndex(motion => motion.jump)
        assert.ok(first >= 0 && (first + 1) * step <= 2 * step + 0.001)
        assert.equal(motions.filter(motion => motion.jump).length, 1)
        feed(undefined, 300)
        assert.equal(feed(pose, 500).filter(motion => motion.jump).length, 1)
      }
    }
  }
})

test('jitter and isolated large spikes do not cause gestures at 20, 30, or 60fps', () => {
  for (const step of [1000 / 60, 1000 / 30, 50]) {
    const { feed } = calibrated(0.24, 4 / 3, step)
    const results = []
    for (let i = 0; i < 30; i++) results.push(...feed(upperBody(0.5, i % 2 ? 0.414 : 0.386)))
    results.push(...feed(upperBody(0.5, 0.26)), ...feed(undefined, 300))
    results.push(...feed(upperBody(0.5, 0.55)), ...feed(undefined, 300))
    assert.equal(results.some(motion => motion.jump || motion.crouching), false)
  }
})

test('crouch confirms within two frames, holds, and releases upright within one frame', () => {
  for (const width of [0.12, 0.24, 0.36]) {
    for (const step of [1000 / 60, 1000 / 30, 50]) {
      const { feed } = calibrated(width, 4 / 3, step)
      const pose = upperBody(0.5, 0.4 + width * 4 / 3 * 0.36, width)
      const motions = feed(pose, 1500)
      const first = motions.findIndex(motion => motion.crouching)
      assert.ok(first >= 0 && (first + 1) * step <= 2 * step + 0.001)
      assert.ok(motions.slice(first).every(motion => motion.crouching && !motion.jump))
      const released = feed(undefined, step)
      assert.equal(released.at(-1)?.crouching, false)
    }
  }
})

test('raised hands need confirmation and visible lowering to rearm', () => {
  const { feed } = calibrated()
  const pose = upperBody()
  pose[15].y = pose[16].y = 0.2
  assert.equal(feed(pose)[0].jump, false)
  assert.equal(feed(undefined, 200).some(motion => motion.jump), false)
  assert.equal(feed(pose, 500).filter(motion => motion.jump).length, 1)
  const hiddenHands = upperBody()
  hiddenHands[15].visibility = hiddenHands[16].visibility = 0
  feed(hiddenHands, 300)
  assert.equal(feed(pose, 500).some(motion => motion.jump), false)
  feed(undefined, 300)
  assert.equal(feed(pose, 500).filter(motion => motion.jump).length, 1)
})

test('hand gestures respond within two frames without accepting single-frame spikes', () => {
  for (const step of [1000 / 60, 1000 / 30, 50]) {
    const { feed } = calibrated(0.24, 4 / 3, step)
    const pose = upperBody()
    pose[15].y = pose[16].y = 0.2
    assert.equal(feed(pose)[0].jump, false)
    assert.equal(feed(undefined, 200).some(motion => motion.jump), false)
    assert.equal(feed(pose, 2 * step).filter(motion => motion.jump).length, 1)
  }
})

test('crouching takes priority over raised hands', () => {
  const { feed } = calibrated()
  const pose = upperBody(0.5, 0.55)
  pose[15].y = pose[16].y = 0.2
  const motions = feed(pose, 500)
  assert.equal(motions.some(motion => motion.jump), false)
  assert.equal(motions.at(-1)?.crouching, true)
})

test('tracking loss releases crouch and does not fire a jump on reacquisition', () => {
  const { feed } = calibrated()
  assert.equal(feed(upperBody(0.5, 0.55), 500).at(-1)?.crouching, true)
  assert.equal(feed([])[0].status, 'lost')
  assert.equal(feed([])[0].crouching, false)
  assert.equal(feed(upperBody(0.5, 0.3), 200).some(motion => motion.jump), false)
})

test('prolonged tracking loss recalibrates at the new neutral position', () => {
  const { feed } = calibrated()
  feed([], 700)
  const motions = feed(upperBody(0.5, 0.3), 1000)
  assert.equal(motions[0].status, 'calibrating')
  assert.equal(motions.at(-1)?.status, 'tracking')
  assert.equal(motions.some(motion => motion.jump || motion.crouching), false)
})

test('visible legs do not change the control anchor', () => {
  const pose = upperBody()
  const baseline = getBodyPosition(pose)
  for (const index of [23, 24, 27, 28]) pose[index] = { x: 0.8, y: 0.9, visibility: 1 }
  assert.deepEqual(getBodyPosition(pose), baseline)
})

test('sustained upward intent jumps below the old threshold, without repeating during the same rise', () => {
  for (const step of [1000 / 30, 1000 / 60]) {
    for (const width of [.12, .24, .36]) {
      const { feed } = calibrated(width, 4 / 3, step)
      const results = []
      for (let frame = 1; frame <= 12; frame++) {
        const height = frame * step / 1000 * 1.6
        results.push(...feed(upperBody(.5, .4 - height * width * 4 / 3, width)))
      }
      const first = results.findIndex(result => result.jump)
      assert.ok(first >= 0 && (first + 1) * step <= 70)
      assert.ok(results[first].height < .18)
      assert.equal(results.filter(result => result.jump).length, 1)
      feed(undefined, 300)
      assert.equal(feed(upperBody(.5, .3, width), 200).filter(result => result.jump).length, 1)
    }
  }
})

test('ordinary crouch recovery and modest overshoot are not predicted as jumps', () => {
  const step = 1000 / 60
  const { feed } = calibrated(.24, 4 / 3, step)
  feed(upperBody(.5, .4 + .4 * .32), 300)
  for (const height of [-.3, -.2, -.1, 0, .04, .08, .12, .08, .04, 0]) {
    assert.equal(feed(upperBody(.5, .4 - height * .32))[0].jump, false)
  }
  feed(undefined, 300)
  const results = [ .03, .06, .09, .12 ].flatMap(height => feed(upperBody(.5, .4 - height * .32)))
  assert.equal(results.filter(result => result.jump).length, 1)
})

test('a genuine rise well above neutral can still jump after a preparatory crouch', () => {
  const { feed } = calibrated()
  feed(upperBody(.5, .55), 300)
  assert.equal(feed(upperBody(.5, .3), 200).filter(result => result.jump).length, 1)
})

test('slow neutral drift and a stalled frame do not qualify for early intent prediction', () => {
  const { feed } = calibrated(.24, 4 / 3, 50)
  for (let height = 0; height < .16; height += .005) assert.equal(feed(upperBody(.5, .4 - height * .32))[0].jump, false)
  const tracker = createBodyTracker()
  for (let t = 0; t <= 1000; t += 50) tracker.update(upperBody(), t)
  assert.equal(tracker.update(upperBody(.5, .4 - .07 * .32), 1200).jump, false)
  assert.equal(tracker.update(upperBody(.5, .4 - .09 * .32), 1217).jump, false)
})

test('small jumps after bending the knees register at 10 through 60 camera fps', () => {
  for (const step of [1000 / 60, 1000 / 30, 50, 100]) {
    for (const width of [.12, .24, .36]) {
      for (const aspect of [4 / 3, 16 / 9]) {
        const { feed } = calibrated(width, aspect, step)
        const poseAt = (height: number) => upperBody(.5, .4 - height * width * aspect, width)
        feed(poseAt(-.3), 300)
        const results = [-.15, 0, .07, .14, .16, .08, 0].flatMap(height => feed(poseAt(height)))
        assert.equal(results.filter(result => result.jump).length, 1, `${step}, ${width}, ${aspect}`)
        assert.ok(results.findIndex(result => result.jump) <= 4)
      }
    }
  }
})

test('landing near neutral rearms repeated jumps without requiring the exact calibrated height', () => {
  for (const step of [1000 / 60, 1000 / 30, 50, 100]) {
    const { feed } = calibrated(.24, 4 / 3, step)
    for (let jump = 0; jump < 4; jump++) {
      const results = [.08, .14, .20, .22, .15, .06].flatMap(height => feed(upperBody(.5, .4 - height * .32)))
      assert.equal(results.filter(result => result.jump).length, 1, `jump ${jump}, ${step}ms`)
      feed(upperBody(.5, .4 - .06 * .32), 200)
    }
  }
})

test('a small rise held above neutral fires once, and slow posture changes after a crouch do not jump', () => {
  const { feed } = calibrated()
  feed(upperBody(.5, .4 + .3 * .32), 300)
  const results = [-.1, 0, .08, .14].flatMap(height => feed(upperBody(.5, .4 - height * .32)))
  results.push(...feed(upperBody(.5, .4 - .14 * .32), 1000))
  assert.equal(results.filter(result => result.jump).length, 1)
  feed(undefined, 300)
  feed(upperBody(.5, .4 + .3 * .32), 300)
  for (let height = -.3; height < .16; height += .005) {
    assert.equal(feed(upperBody(.5, .4 - height * .32))[0].jump, false)
  }
})

test('successive small camera jumps after crouching reach the running game', () => {
  for (const step of [1000 / 60, 1000 / 30, 50, 100]) {
    const { feed } = calibrated(.24, 4 / 3, step)
    const game = newGame()
    game.phase = 'running'
    const apply = (height: number, duration = step) => {
      for (const motion of feed(upperBody(.5, .4 - height * .32), duration)) {
        if (!motion.crouching) game.slide = 0
        if (motion.jump) assert.equal(requestJump(game), true)
        if (motion.crouching && game.jump === 0) game.slide = .8
        advanceGame(game, step / 1000, Math.random, { spawn: false })
      }
    }
    for (let jump = 1; jump <= 3; jump++) {
      apply(-.3, 200)
      for (const height of [-.15, 0, .07, .14, .16, .08]) apply(height)
      apply(.06, 700)
      assert.equal(game.jumpId, jump, `${step}ms camera, jump ${jump}`)
    }
  }
})

test('optional hips calibrate only after a stable neutral hold and do not change the lane anchor', () => {
  const { feed } = calibrated()
  assert.equal(feed()[0].jumpTracking, 'shoulders')
  assert.equal(feed(fullBody())[0].jumpTracking, 'shoulders')
  const ready = feed(fullBody(), 800).at(-1)!
  assert.equal(ready.jumpTracking, 'hips')
  assert.equal(ready.jumpReady, true)
  assert.equal(ready.jump, false)
  const leaned = fullBody()
  leaned[11].x -= .12
  leaned[12].x -= .12
  const results = feed(leaned, 300)
  assert.equal(results.at(-1)?.lane, 1)
  assert.equal(results.some(result => result.jump), false)
})

test('hip rise confirms smaller shoulder takeoffs before landing across distances and frame rates', () => {
  for (const step of [1000 / 60, 1000 / 30, 50, 100]) {
    for (const width of [.12, .24, .36]) {
      for (const aspect of [4 / 3, 16 / 9]) {
        const { feed } = calibrated(width, aspect, step, fullBody(0, 0, width, aspect))
        assert.equal(feed(undefined, 800).at(-1)?.jumpTracking, 'hips')
        const results = [[.01, .03], [.03, .08], [.045, .14], [.055, .18], [.06, .20]]
          .flatMap(([shoulders, hips]) => feed(fullBody(shoulders, hips, width, aspect)))
        const first = results.findIndex(result => result.jump)
        assert.ok(first >= 0 && first <= 3, `${step}ms, width ${width}, aspect ${aspect}`)
        assert.equal(results.filter(result => result.jump).length, 1)
        assert.equal(feed(fullBody(.06, .20, width, aspect), 500).some(result => result.jump), false)
      }
    }
  }
})

test('visible stationary hips reject shoulder shrugs but never block raised-hand jumps', () => {
  const { feed } = calibrated(.24, 4 / 3, 50, fullBody())
  feed(undefined, 800)
  assert.equal(feed(fullBody(.3, 0), 400).some(result => result.jump), false)
  feed(undefined, 300)
  const hands = fullBody()
  hands[15].y = hands[16].y = .2
  assert.equal(feed(hands, 300).filter(result => result.jump).length, 1)
  feed(fullBody(0, .2), 300)
  assert.equal(feed(hands, 300).filter(result => result.jump).length, 1)
})

test('hip spikes, slow posture changes, and crouch recovery do not invent jumps', () => {
  for (const step of [1000 / 60, 1000 / 30, 50, 100]) {
    const { feed } = calibrated(.24, 4 / 3, step, fullBody())
    feed(undefined, 800)
    const results = feed(fullBody(.05, .6))
    results.push(...feed(fullBody(.05, 0), 300))
    results.push(...feed(fullBody(-.3, -.3), 300))
    for (const height of [-.2, -.1, 0, .04, .08, .12, .08, .04, 0]) {
      results.push(...feed(fullBody(height, Math.min(height, .03))))
    }
    assert.equal(results.some(result => result.jump), false)
    feed(undefined, 300)
    for (let height = 0; height < .16; height += .005) {
      assert.equal(feed(fullBody(height, height))[0].jump, false)
    }
  }
})

test('body jumps rearm on hip landing, not merely when shoulders return to neutral midair', () => {
  const { feed } = calibrated(.24, 4 / 3, 50, fullBody())
  feed(undefined, 800)
  assert.equal(feed(fullBody(.05, .2), 200).filter(result => result.jump).length, 1)
  assert.equal(feed(fullBody(0, .2), 300).at(-1)?.jumpReady, false)
  assert.equal(feed(fullBody(.05, .2), 200).some(result => result.jump), false)
  assert.equal(feed(fullBody(.06, .06), 200).at(-1)?.jumpReady, true)
  assert.equal(feed(fullBody(.05, .2), 200).filter(result => result.jump).length, 1)
})

test('missing or invalid hips immediately restore shoulder-only play without a synthetic jump', () => {
  for (const missing of [23, 24]) {
    for (const invalid of [{ visibility: .2 }, { x: NaN }, { y: 1.1 }]) {
      const { feed } = calibrated(.24, 4 / 3, 50, fullBody())
      feed(undefined, 800)
      const pose = fullBody()
      pose[missing] = { ...pose[missing], ...invalid }
      const motion = feed(pose)[0]
      assert.equal(motion.jumpTracking, 'shoulders')
      assert.equal(motion.jump, false)
      assert.equal(feed(upperBody(.5, .3), 200).filter(result => result.jump).length, 1)
    }
  }
})

test('newly visible hips cannot calibrate during takeoff or fire on reacquisition', () => {
  const { feed } = calibrated()
  const results = feed(fullBody(.3, .3), 800)
  assert.ok(results.every(result => result.jumpTracking === 'shoulders'))
  feed(fullBody(), 1000)
  assert.equal(feed(fullBody())[0].jumpTracking, 'hips')
  feed([])
  assert.equal(feed(fullBody(.2, .2), 200).some(result => result.jump), false)
  assert.equal(feed(fullBody(.2, .2))[0].jumpTracking, 'shoulders')
})

test('neutral reset discards the old hip baseline and learns the new position safely', () => {
  const tracker = createBodyTracker()
  for (let time = 0; time <= 2000; time += 50) tracker.update(fullBody(), time)
  tracker.captureNeutral({ x: .5, y: .5, scale: .32 }, 2050)
  const pose = fullBody()
  pose[11].y = pose[12].y = .5
  pose[15].y = pose[16].y = .7
  pose[23].y = pose[24].y = .8
  for (let time = 2100; time <= 3000; time += 50) assert.equal(tracker.update(pose, time).jump, false)
  assert.equal(tracker.update(pose, 3050).jumpTracking, 'hips')
})

test('hip-assisted takeoffs after a knee bend start successive game jumps without waiting for landing', () => {
  for (const step of [1000 / 60, 1000 / 30, 50, 100]) {
    const { feed } = calibrated(.24, 4 / 3, step, fullBody())
    feed(undefined, 800)
    const game = newGame()
    game.phase = 'running'
    const apply = (shoulders: number, hips: number, duration = step) => {
      for (const motion of feed(fullBody(shoulders, hips), duration)) {
        if (!motion.crouching) game.slide = 0
        if (motion.jump) assert.equal(requestJump(game), true)
        if (motion.crouching && game.jump === 0) game.slide = .8
        advanceGame(game, step / 1000, Math.random, { spawn: false })
      }
    }
    for (let jump = 1; jump <= 3; jump++) {
      apply(-.3, -.3, 200)
      for (const [shoulders, hips] of [[-.1, -.1], [0, 0], [.03, .14], [.05, .2], [.06, .22]]) apply(shoulders, hips)
      assert.equal(game.jumpId, jump, `${step}ms camera, takeoff ${jump}`)
      apply(.05, .2, 200)
      assert.equal(game.jumpId, jump)
      apply(.06, .06, 700)
    }
  }
})
