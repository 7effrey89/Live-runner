import { getBodyPosition, isVisiblePoint } from './bodyTracking.ts'
import type { BodyPoint, BodyPosition } from './bodyTracking.ts'

export function crossedArmsState(pose: readonly BodyPoint[]): 'crossed' | 'uncrossed' | 'lost' {
  const indices = [11, 12, 13, 14, 15, 16]
  if (!indices.every(index => isVisiblePoint(pose[index]))) return 'lost'
  const [left, right, a, b, c, d] = indices.map(index => pose[index])
  const width = Math.abs(left.x - right.x)
  if (width < 0.08 || (c.x - d.x) * (left.x - right.x) >= -((width * 0.15) ** 2)) return 'uncrossed'
  const rx = c.x - a.x, ry = c.y - a.y, sx = d.x - b.x, sy = d.y - b.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) < 0.0001) return 'uncrossed'
  const t = ((b.x - a.x) * sy - (b.y - a.y) * sx) / denominator
  const u = ((b.x - a.x) * ry - (b.y - a.y) * rx) / denominator
  const x = a.x + t * rx, y = a.y + t * ry
  const shoulderY = (left.y + right.y) / 2
  return t > 0.1 && t < 0.9 && u > 0.1 && u < 0.9
    && x > Math.min(left.x, right.x) - width * 0.2 && x < Math.max(left.x, right.x) + width * 0.2
    && y > shoulderY - width * 0.3 && y < shoulderY + width * 1.2 ? 'crossed' : 'uncrossed'
}

export function createCrossedArmsCalibrator() {
  let baseline: BodyPosition | undefined
  let start = 0
  let count = 0
  let lastTime: number | undefined
  let fired = false
  return {
    update(pose: readonly BodyPoint[], time: number, aspectRatio = 4 / 3): { active: boolean; progress: number; neutral?: BodyPosition } {
      const state = crossedArmsState(pose)
      const gap = lastTime === undefined ? 0 : time - lastTime
      lastTime = time
      if (state !== 'crossed') {
        baseline = undefined
        if (state === 'uncrossed') fired = false
        return { active: false, progress: 0 }
      }
      if (fired) return { active: true, progress: 1 }
      const position = getBodyPosition(pose, aspectRatio)!
      if (!baseline || gap > 250
        || Math.hypot((position.x - baseline.x) * aspectRatio, position.y - baseline.y) > position.scale * 0.08
        || Math.abs(position.scale - baseline.scale) > baseline.scale * 0.12) {
        baseline = position
        start = time
        count = 1
      } else {
        count++
        baseline = {
          x: baseline.x + (position.x - baseline.x) / count,
          y: baseline.y + (position.y - baseline.y) / count,
          scale: baseline.scale + (position.scale - baseline.scale) / count,
        }
      }
      const progress = Math.min(1, (time - start) / 1000)
      if (progress === 1 && count >= 8) {
        fired = true
        return { active: true, progress: 1, neutral: baseline }
      }
      return { active: true, progress }
    },
  }
}
