import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFrameRateCounter } from '../src/frameRate.ts'

test('reports measured frame rates independently of the display refresh target', () => {
  for (const rate of [10, 30, 60, 120, 144]) {
    const counter = createFrameRateCounter(100)
    for (let frame = 0; frame < rate; frame++) counter.record()
    assert.equal(counter.sample(1100), rate)
  }
})

test('uses actual elapsed time when the sampling timer is delayed', () => {
  const counter = createFrameRateCounter(0)
  for (let frame = 0; frame < 60; frame++) counter.record()
  assert.equal(counter.sample(2500), 24)
  counter.record()
  assert.equal(counter.sample(4500), 0.5)
})

test('reports zero for stalled frames and counts only the current sampling window', () => {
  const counter = createFrameRateCounter(0)
  for (let frame = 0; frame < 60; frame++) counter.record()
  assert.equal(counter.sample(1000), 60)
  assert.equal(counter.sample(2000), 0)
  for (let frame = 0; frame < 30; frame++) counter.record()
  assert.equal(counter.sample(3000), 30)
})

test('reset discards old frames and starts a fresh measurement window', () => {
  const counter = createFrameRateCounter(0)
  for (let frame = 0; frame < 30; frame++) counter.record()
  counter.reset(5000)
  for (let frame = 0; frame < 15; frame++) counter.record()
  assert.equal(counter.sample(5500), 30)
})

test('separate game and tracking counters do not affect each other', () => {
  const game = createFrameRateCounter(0)
  const tracking = createFrameRateCounter(0)
  for (let frame = 0; frame < 60; frame++) {
    game.record()
    if (frame % 2 === 0) tracking.record()
  }
  assert.equal(game.sample(1000), 60)
  assert.equal(tracking.sample(1000), 30)
})

test('equal timestamps preserve pending frames until time advances', () => {
  const counter = createFrameRateCounter(100)
  counter.record()
  assert.equal(counter.sample(100), undefined)
  assert.equal(counter.sample(200), 10)
})

test('invalid or backwards measurement timestamps fail explicitly', () => {
  for (const time of [NaN, Infinity, -1]) assert.throws(() => createFrameRateCounter(time), RangeError)
  const counter = createFrameRateCounter(100)
  for (const time of [NaN, Infinity, 99]) {
    assert.throws(() => counter.sample(time), RangeError)
    assert.throws(() => counter.reset(time), RangeError)
  }
})
