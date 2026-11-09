import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPoseTracker, MAX_TRACKING_FPS } from '../src/poseTracker.ts'
import type { PoseResult, PoseWorkerPort, PoseWorkerRequest, PoseWorkerResponse } from '../src/poseTracker.ts'

class FakeWorker implements PoseWorkerPort {
  onmessage: PoseWorkerPort['onmessage'] = null
  onerror: PoseWorkerPort['onerror'] = null
  onmessageerror: PoseWorkerPort['onmessageerror'] = null
  messages: { message: PoseWorkerRequest; transfer: Transferable[] }[] = []
  terminated = 0
  postError?: Error
  postMessage(message: PoseWorkerRequest, transfer: Transferable[]) {
    if (this.postError) throw this.postError
    this.messages.push({ message, transfer })
  }
  terminate() { this.terminated++ }
  emit(data: PoseWorkerResponse) { this.onmessage?.(new MessageEvent('message', { data })) }
}

const empty: PoseResult = { landmarks: [], worldLandmarks: [] }
const flush = () => new Promise(resolve => setImmediate(resolve))
function bitmap() {
  return { width: 640, height: 480, closed: 0, close() { this.closed++ } }
}

test('tracking waits for initialization, transfers one frame, and preserves capture timestamps and four-player capacity', async () => {
  const worker = new FakeWorker()
  const image = bitmap()
  const results: { result: PoseResult; timestamp: number }[] = []
  const tracker = createPoseTracker({
    numPoses: 4, onResult: (result, timestamp) => results.push({ result, timestamp }), onError: assert.fail,
  }, { worker, capture: async () => image })
  assert.deepEqual(worker.messages[0].message, { type: 'init', numPoses: 4 })
  assert.equal(tracker.detect(image, 0), false)
  worker.emit({ type: 'ready' })
  await tracker.ready
  assert.equal(tracker.detect(image, 12), true)
  await flush()
  assert.deepEqual(worker.messages[1], { message: { type: 'frame', frame: image, timestamp: 12 }, transfer: [image] })
  assert.equal(image.closed, 0)
  worker.emit({ type: 'result', timestamp: 12, result: empty })
  assert.deepEqual(results, [{ timestamp: 12, result: empty }])
  tracker.close()
})

test('slow inference drops intermediate frames instead of queuing, and admits only the latest frame after completion', async () => {
  const worker = new FakeWorker()
  let captures = 0
  const image = bitmap()
  const tracker = createPoseTracker({ numPoses: 4, onResult() {}, onError: assert.fail }, {
    worker, capture: async () => { captures++; return image },
  })
  worker.emit({ type: 'ready' })
  await tracker.ready
  assert.equal(tracker.detect(image, 0), true)
  for (let time = 10; time <= 500; time += 10) assert.equal(tracker.detect(image, time), false)
  await flush()
  assert.equal(captures, 1)
  assert.equal(worker.messages.length, 2)
  worker.emit({ type: 'result', timestamp: 0, result: empty })
  assert.equal(tracker.detect(image, 501), true)
  await flush()
  assert.equal(captures, 2)
  assert.equal(worker.messages[2].message.type, 'frame')
  if (worker.messages[2].message.type === 'frame') assert.equal(worker.messages[2].message.timestamp, 501)
  tracker.close()
})

test('tracking is capped at 30 requests per second even when every inference completes immediately', async () => {
  const worker = new FakeWorker()
  const image = bitmap()
  const tracker = createPoseTracker({ numPoses: 4, onResult() {}, onError: assert.fail }, { worker, capture: async () => image })
  worker.emit({ type: 'ready' })
  await tracker.ready
  let admitted = 0
  for (let time = 0; time < 1000; time++) {
    if (tracker.detect(image, time)) {
      admitted++
      await flush()
      worker.emit({ type: 'result', timestamp: time, result: empty })
    }
  }
  assert.equal(admitted, MAX_TRACKING_FPS)
  assert.equal(tracker.detect(image, 1), false)
  for (const time of [NaN, Infinity, -1]) assert.throws(() => tracker.detect(image, time), RangeError)
  tracker.close()
})

test('stopping during a pending capture closes its bitmap and ignores late replies without reviving the worker', async () => {
  const worker = new FakeWorker()
  const image = bitmap()
  let resolveCapture: (image: ImageBitmap) => void = assert.fail
  const pendingCapture = new Promise<ImageBitmap>(resolve => { resolveCapture = resolve })
  const tracker = createPoseTracker({ numPoses: 4, onResult: assert.fail, onError: assert.fail }, { worker, capture: () => pendingCapture })
  worker.emit({ type: 'ready' })
  await tracker.ready
  const lateReply = worker.onmessage
  tracker.detect(image, 0)
  await flush()
  tracker.close()
  tracker.close()
  resolveCapture(image)
  await flush()
  lateReply?.(new MessageEvent('message', { data: { type: 'result', result: empty, timestamp: 0 } }))
  assert.equal(image.closed, 1)
  assert.equal(worker.messages.length, 1)
  assert.equal(worker.terminated, 1)
  assert.equal(tracker.detect(image, 1000), false)
})

test('initialization errors reject readiness and cancellation releases a still-loading worker', async () => {
  for (const cancelled of [false, true]) {
    const worker = new FakeWorker()
    const tracker = createPoseTracker({ numPoses: 4, onResult: assert.fail, onError: assert.fail }, { worker, capture: async () => bitmap() })
    const rejection = assert.rejects(tracker.ready, cancelled ? { name: 'AbortError' } : /Model failed to load/)
    if (cancelled) tracker.close()
    else worker.emit({ type: 'error', message: 'Model failed to load' })
    await rejection
    assert.equal(worker.terminated, 1)
    assert.equal(worker.onmessage, null)
  }
})

test('capture, transfer, result-handler, and decoding failures are reported once and terminate tracking', async () => {
  for (const failure of ['capture', 'transfer', 'result', 'decode'] as const) {
    const worker = new FakeWorker()
    const image = bitmap()
    const errors: Error[] = []
    const tracker = createPoseTracker({
      numPoses: 4,
      onResult() { throw new Error('Result handler failed') },
      onError: error => errors.push(error),
    }, { worker, capture: async () => { if (failure === 'capture') throw new Error('Capture failed'); return image } })
    worker.emit({ type: 'ready' })
    await tracker.ready
    if (failure === 'transfer') worker.postError = new Error('Transfer failed')
    tracker.detect(image, 0)
    await flush()
    if (failure === 'result') worker.emit({ type: 'result', timestamp: 0, result: empty })
    if (failure === 'decode') worker.onmessageerror?.(new MessageEvent('messageerror'))
    assert.equal(errors.length, 1)
    assert.equal(worker.terminated, 1)
    assert.equal(tracker.detect(image, 1000), false)
    if (failure === 'transfer') assert.equal(image.closed, 1)
    tracker.close()
    assert.equal(worker.terminated, 1)
  }
})
