import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDwellController, getHandPointer } from '../src/handPointer.ts'
import type { BodyPoint } from '../src/bodyTracking.ts'

function hands(left?: BodyPoint, right?: BodyPoint): BodyPoint[] {
  const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
  if (left) pose[15] = { visibility: 1, ...left }
  if (right) pose[16] = { visibility: 1, ...right }
  return pose
}

const pointer = { hand: 'right' as const, x: 200, y: 300 }

test('either visible hand can aim without requiring shoulders or legs', () => {
  assert.equal(getHandPointer(hands({ x: 0.5, y: 0.5 }))?.hand, 'left')
  assert.equal(getHandPointer(hands(undefined, { x: 0.5, y: 0.5 }))?.hand, 'right')
  assert.equal(getHandPointer([]), undefined)
  assert.equal(getHandPointer(hands({ x: 0.5, y: 0.5, visibility: 0.3 })), undefined)
})

test('camera area maps to mirrored screen coordinates and reachable corners', () => {
  const center = getHandPointer(hands(undefined, { x: 0.5, y: 0.5 }))
  assert.ok(center && Math.abs(center.x - 0.5) < 1e-10 && Math.abs(center.y - 0.5) < 1e-10)
  assert.deepEqual(getHandPointer(hands(undefined, { x: 0.1, y: 0.1 })), { hand: 'right', x: 1, y: 0 })
  assert.deepEqual(getHandPointer(hands(undefined, { x: 0.9, y: 0.9 })), { hand: 'right', x: 0, y: 1 })
})

test('hand selection stays stable through jitter and switches to a clearly raised hand', () => {
  const pose = hands({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.48 })
  assert.equal(getHandPointer(pose, 'left')?.hand, 'left')
  pose[16].y = 0.3
  assert.equal(getHandPointer(pose, 'left')?.hand, 'right')
  pose[16].visibility = 0
  assert.equal(getHandPointer(pose, 'right')?.hand, 'left')
})

test('dwell clicks at 600ms, never early, and never repeats while staying over a button', () => {
  const dwell = createDwellController<string>()
  for (let time = 0; time < 600; time += 50) {
    const result = dwell.update(pointer, 'start', time)
    assert.equal(result.click, undefined)
    assert.equal(result.progress, time / 600)
  }
  assert.equal(dwell.update(pointer, 'start', 600).click, 'start')
  for (let time = 650; time < 2000; time += 50) assert.equal(dwell.update(pointer, 'start', time).click, undefined)
  dwell.update(pointer, undefined, 2000)
  for (let time = 2050; time < 2650; time += 50) dwell.update(pointer, 'start', time)
  assert.equal(dwell.update(pointer, 'start', 2650).click, 'start')
})

test('changing targets, hands, or moving too far resets dwell', () => {
  for (const changed of [
    { point: pointer, target: 'other' },
    { point: { ...pointer, hand: 'left' as const }, target: 'start' },
    { point: { ...pointer, x: 231 }, target: 'start' },
  ]) {
    const dwell = createDwellController<string>()
    for (let time = 0; time <= 500; time += 50) dwell.update(pointer, 'start', time)
    assert.equal(dwell.update(changed.point, changed.target, 550).progress, 0)
    assert.equal(dwell.update(changed.point, changed.target, 600).click, undefined)
  }
})

test('tracking loss and frame stalls cannot complete a pending click', () => {
  for (const lost of [true, false]) {
    const dwell = createDwellController<string>()
    for (let time = 0; time <= 500; time += 50) dwell.update(pointer, 'start', time)
    if (lost) dwell.update(undefined, undefined, 550)
    const resumed = dwell.update(pointer, 'start', 900)
    assert.equal(resumed.progress, 0)
    assert.equal(resumed.click, undefined)
  }
})

test('losing and reacquiring a hand cannot repeat an already fired click', () => {
  const dwell = createDwellController<string>()
  for (let time = 0; time <= 600; time += 50) dwell.update(pointer, 'toggle', time)
  dwell.update(undefined, undefined, 650)
  for (let time = 700; time <= 1500; time += 50) assert.equal(dwell.update(pointer, 'toggle', time).click, undefined)
})
