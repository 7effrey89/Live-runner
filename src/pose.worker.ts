import { PoseLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import type { PoseWorkerRequest, PoseWorkerResponse } from './poseTracker'

let detector: PoseLandmarker | undefined

function reply(message: PoseWorkerResponse) {
  self.postMessage(message)
}

self.onmessage = async ({ data }: MessageEvent<PoseWorkerRequest>) => {
  try {
    if (data.type === 'init') {
      detector = await PoseLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO', numPoses: data.numPoses, outputSegmentationMasks: false,
      })
      reply({ type: 'ready' })
    } else {
      try {
        if (!detector) throw new Error('Body tracking is not initialized')
        const { landmarks, worldLandmarks } = detector.detectForVideo(data.frame, data.timestamp)
        reply({ type: 'result', timestamp: data.timestamp, result: { landmarks, worldLandmarks } })
      } finally {
        data.frame.close()
      }
    }
  } catch (error) {
    detector?.close()
    detector = undefined
    reply({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
