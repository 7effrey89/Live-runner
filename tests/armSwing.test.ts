import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createArmSwingTracker } from '../src/armSwing.ts'
import type { BodyPoint } from '../src/bodyTracking.ts'

function pose(wrist = .35, joint = 16, shift = 0, lift = 0): BodyPoint[] {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }))
  points[11] = { x: .6 + shift, y: .4 + lift, visibility: 1 }
  points[12] = { x: .4 + shift, y: .4 + lift, visibility: 1 }
  points[joint] = { x: wrist + shift, y: .6 + lift, visibility: 1 }
  return points
}

test('either arm can confirm a deliberate swing across fresh samples at 10–60 camera FPS', () => {
  for (const joint of [15, 16]) for (const dt of [100, 50, 1000 / 30, 1000 / 60]) {
    const tracker = createArmSwingTracker()
    assert.equal(tracker.update(pose(.35, joint), 0), false)
    assert.equal(tracker.update(pose(.42, joint), dt), false)
    assert.equal(tracker.update(pose(.49, joint), dt * 2), true)
    assert.equal(tracker.hand, joint === 15 ? 'left' : 'right')
  }
})

test('jitter, an isolated spike, slow movement, and whole-body leaning or jumping do not swing', () => {
  for (const sequence of [
    [.35, .351, .349, .352, .35],
    [.35, .6, .35, .35, .35],
    [.35, .6, .6, .6, .6],
    [.35, .355, .36, .365, .37],
  ]) {
    const tracker = createArmSwingTracker()
    sequence.forEach((wrist, index) => assert.equal(tracker.update(pose(wrist), index * 50), false))
  }
  const tracker = createArmSwingTracker()
  for (let frame = 0; frame < 5; frame++) assert.equal(tracker.update(pose(.35, 16, frame * .04, -frame * .03), frame * 50), false)
})

test('tracking loss, a long gap, menu pointing, and recalibration reset swing candidates', () => {
  for (const reset of ['lost', 'gap', 'suppressed'] as const) {
    const tracker = createArmSwingTracker()
    tracker.update(pose(.35), 0)
    tracker.update(pose(.42), 50)
    if (reset === 'lost') tracker.update([], 75)
    if (reset === 'suppressed') tracker.update(pose(.45), 75, 4 / 3, true)
    assert.equal(tracker.update(pose(.49), reset === 'gap' ? 500 : 100), false)
  }
})

test('a cooldown prevents one movement from repeatedly destroying obstacles and does not mix players', () => {
  const first = createArmSwingTracker()
  const second = createArmSwingTracker()
  for (const tracker of [first, second]) tracker.update(pose(.35), 0)
  first.update(pose(.42), 50)
  assert.equal(first.update(pose(.49), 100), true)
  assert.equal(first.update(pose(.56), 150), false)
  assert.equal(first.update(pose(.63), 200), false)
  assert.equal(second.update(pose(.42), 150), false)
  assert.equal(second.update(pose(.49), 200), true)
  first.update(pose(.35), 600)
  first.update(pose(.42), 650)
  assert.equal(first.update(pose(.49), 700), true)
})
