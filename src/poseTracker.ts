import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision'

export type PoseResult = { landmarks: NormalizedLandmark[][]; worldLandmarks: Landmark[][] }
export type PoseWorkerRequest =
  | { type: 'init'; numPoses: number }
  | { type: 'frame'; frame: ImageBitmap; timestamp: number }
export type PoseWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; result: PoseResult; timestamp: number }
  | { type: 'error'; message: string }
export type PoseWorkerPort = {
  onmessage: ((event: MessageEvent<PoseWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: PoseWorkerRequest, transfer: Transferable[]) => void
  terminate: () => void
}
type Environment = { worker: PoseWorkerPort; capture: (source: ImageBitmapSource) => Promise<ImageBitmap> }
export const MAX_TRACKING_FPS = 30

export function createPoseTracker(options: {
  numPoses: number; onResult: (result: PoseResult, timestamp: number) => void; onError: (error: Error) => void
}, environment?: Environment) {
  if (!environment && (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function')) {
    throw new Error('This browser does not support background webcam tracking. Use keyboard controls or a newer browser.')
  }
  const worker: PoseWorkerPort = environment?.worker ?? new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module', name: 'pose-tracking' })
  const capture = environment?.capture ?? (source => createImageBitmap(source))
  let closed = false
  let initialized = false
  let busy = false
  let lastSubmitted = -Infinity
  let resolveReady: () => void
  let rejectReady: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const dispose = () => {
    closed = true
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  }
  const fail = (reason: unknown) => {
    if (closed) return
    const error = reason instanceof Error ? reason : new Error(String(reason))
    dispose()
    if (initialized) options.onError(error)
    else rejectReady(error)
  }
  worker.onmessage = ({ data }) => {
    if (closed) return
    if (data.type === 'error') { fail(new Error(data.message)); return }
    if (data.type === 'ready') {
      initialized = true
      resolveReady()
    } else {
      busy = false
      try { options.onResult(data.result, data.timestamp) } catch (error) { fail(error) }
    }
  }
  worker.onerror = event => {
    event.preventDefault()
    fail(new Error(event.message || 'Background body tracking failed'))
  }
  worker.onmessageerror = () => fail(new Error('Could not decode the background tracking result'))
  try { worker.postMessage({ type: 'init', numPoses: options.numPoses }, []) } catch (error) { fail(error) }
  return {
    ready,
    detect(source: ImageBitmapSource, timestamp: number) {
      if (!Number.isFinite(timestamp) || timestamp < 0) throw new RangeError('Tracking timestamp must be finite and non-negative')
      if (closed || !initialized || busy || timestamp - lastSubmitted < 1000 / MAX_TRACKING_FPS) return false
      busy = true
      lastSubmitted = timestamp
      void Promise.resolve().then(() => capture(source)).then(frame => {
        if (closed) { frame.close(); return }
        try { worker.postMessage({ type: 'frame', frame, timestamp }, [frame]) }
        catch (error) { frame.close(); fail(error) }
      }).catch(fail)
      return true
    },
    close() {
      if (closed) return
      dispose()
      if (!initialized) rejectReady(new DOMException('Background tracking stopped', 'AbortError'))
    },
  }
}
