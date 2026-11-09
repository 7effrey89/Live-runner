import { getBodyPosition, isVisiblePoint } from './bodyTracking.ts'
import type { BodyPoint } from './bodyTracking.ts'

type Sample = { x: number; y: number; time: number; dx: number; dy: number; start: number; count: number }

export function createArmSwingTracker() {
  let samples: (Sample | undefined)[] = []
  let lastSwing = -Infinity
  let lastHand: 'left' | 'right' = 'right'
  return {
    get hand() { return lastHand },
    update(pose: readonly BodyPoint[], time: number, aspect = 4 / 3, suppressed = false) {
      if (!Number.isFinite(time) || time < 0) throw new RangeError('Arm-swing time must be finite and non-negative')
      const body = getBodyPosition(pose, aspect)
      if (suppressed || !body) {
        samples = []
        return false
      }
      let swing = false
      for (const [index, joint] of [15, 16].entries()) {
        const wrist = pose[joint]
        if (!isVisiblePoint(wrist)) {
          samples[index] = undefined
          continue
        }
        const next: Sample = {
          x: (wrist.x - body.x) * aspect / body.scale, y: (wrist.y - body.y) / body.scale,
          time, dx: 0, dy: 0, start: time, count: 0,
        }
        const previous = samples[index]
        if (previous) {
          const dt = time - previous.time
          const dx = next.x - previous.x
          const dy = next.y - previous.y
          if (dt >= 12 && dt <= 150 && Math.hypot(dx, dy) * 1000 / dt >= 1.2 && time - lastSwing >= 450) {
            const continuing = previous.count > 0 && time - previous.start <= 250 && dx * previous.dx + dy * previous.dy > 0
            next.dx = dx + (continuing ? previous.dx : 0)
            next.dy = dy + (continuing ? previous.dy : 0)
            next.start = continuing ? previous.start : previous.time
            next.count = continuing ? previous.count + 1 : 1
            if (next.count >= 2 && time - next.start >= 24 && Math.hypot(next.dx, next.dy) >= .55 && !swing) {
              swing = true
              lastHand = index === 0 ? 'left' : 'right'
            }
          }
        }
        samples[index] = next
      }
      if (swing) {
        lastSwing = time
        for (const sample of samples) if (sample) sample.count = 0
      }
      return swing
    },
  }
}
