export type BodyPoint = { x: number; y: number; visibility?: number }
export type BodyPosition = { x: number; y: number; scale: number }

export function isVisiblePoint(point: BodyPoint | undefined): point is BodyPoint {
  return !!point && (point.visibility ?? 0) > 0.5
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

export function getBodyPosition(pose: readonly BodyPoint[], aspectRatio = 4 / 3): BodyPosition | undefined {
  const left = pose[11]
  const right = pose[12]
  if (!isVisiblePoint(left) || !isVisiblePoint(right)) return undefined
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    scale: Math.max(0.08, Math.hypot((left.x - right.x) * aspectRatio, left.y - right.y)),
  }
}

type BodyMotion = {
  status: 'calibrating' | 'lost' | 'tracking'
  lane: -1 | 0 | 1
  jump: boolean
  crouching: boolean
  height: number
  shift: number
}

export function createBodyTracker() {
  let baseline: BodyPosition | undefined
  let calibration: BodyPosition | undefined
  let calibrationStart = 0
  let calibrationCount = 0
  let filtered: BodyPosition | undefined
  let lastTime: number | undefined
  let lastSeen: number | undefined
  let candidate: 'body' | 'hands' | 'crouch' | undefined
  let candidateStart = 0
  let candidateSamples = 0
  let jumpSource: 'body' | 'hands' | undefined
  let neutralStart: number | undefined
  let armed = true
  let crouching = false
  let previousHeight: number | undefined
  let upwardSamples = 0
  let roseFromCrouch = false
  const inactive = (status: 'calibrating' | 'lost'): BodyMotion => ({
    status, lane: 0, jump: false, crouching: false, height: 0, shift: 0,
  })

  return {
    captureNeutral(position: BodyPosition, time: number) {
      if (![position.x, position.y, position.scale, time].every(Number.isFinite)
        || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1 || position.scale <= 0) {
        throw new RangeError('Invalid neutral body position')
      }
      baseline = { ...position }
      filtered = baseline
      calibration = undefined
      lastTime = time
      lastSeen = time
      candidate = undefined
      candidateSamples = 0
      crouching = false
      armed = false
      jumpSource = undefined
      neutralStart = undefined
      previousHeight = undefined
      upwardSamples = 0
      roseFromCrouch = false
    },
    update(pose: readonly BodyPoint[], time: number, aspectRatio = 4 / 3, suppressGestures = false): BodyMotion {
      const position = getBodyPosition(pose, aspectRatio)
      const gap = lastSeen === undefined ? 0 : time - lastSeen
      const dt = lastTime === undefined ? 0 : time - lastTime
      lastTime = time
      if (!position) {
        filtered = undefined
        calibration = undefined
        candidate = undefined
        candidateSamples = 0
        neutralStart = undefined
        crouching = false
        armed = false
        previousHeight = undefined
        upwardSamples = 0
        return inactive('lost')
      }
      lastSeen = time
      if (gap > 500) {
        baseline = undefined
        calibration = undefined
        filtered = undefined
        candidate = undefined
        candidateSamples = 0
        crouching = false
        armed = true
        jumpSource = undefined
        neutralStart = undefined
        previousHeight = undefined
        upwardSamples = 0
        roseFromCrouch = false
      }
      if (!baseline) {
        const unstable = !calibration
          || Math.hypot((position.x - calibration.x) * aspectRatio, position.y - calibration.y) > position.scale * 0.08
          || Math.abs(position.scale - calibration.scale) > calibration.scale * 0.12
        if (unstable || !calibration) {
          calibration = position
          calibrationStart = time
          calibrationCount = 1
        } else {
          calibrationCount++
          calibration = {
            x: calibration.x + (position.x - calibration.x) / calibrationCount,
            y: calibration.y + (position.y - calibration.y) / calibrationCount,
            scale: calibration.scale + (position.scale - calibration.scale) / calibrationCount,
          }
        }
        if (time - calibrationStart < 600 || calibrationCount < 8) return inactive('calibrating')
        baseline = calibration
        filtered = baseline
      }
      // Time-based smoothing keeps latency consistent across camera frame rates.
      const alpha = 1 - Math.exp(-dt / 12)
      filtered = filtered ? {
        x: filtered.x + (position.x - filtered.x) * alpha,
        y: filtered.y + (position.y - filtered.y) * alpha,
        scale: position.scale,
      } : position
      const height = (baseline.y - filtered.y) / baseline.scale
      const rawHeight = (baseline.y - position.y) / baseline.scale
      const rise = previousHeight === undefined ? 0 : rawHeight - previousHeight
      const rising = dt >= 12 && dt <= 80 && rise > 0.004
      const velocity = rising ? rise * 1000 / dt : 0
      upwardSamples = rising ? upwardSamples + 1 : 0
      previousHeight = rawHeight
      if (height < -0.16) roseFromCrouch = true
      const earlyRise = !roseFromCrouch && upwardSamples >= 2 && height >= 0.06
        && velocity >= 0.8 && height + velocity * 0.07 > 0.18
      const leftWrist = pose[15]
      const rightWrist = pose[16]
      const handsVisible = isVisiblePoint(leftWrist) && isVisiblePoint(rightWrist)
      const handHeight = handsVisible
        ? Math.min(pose[11].y - leftWrist.y, pose[12].y - rightWrist.y) / baseline.scale
        : undefined
      if (crouching && height > -0.10) crouching = false
      const nextCandidate = height < -0.22 ? 'crouch'
        : !crouching && height > 0.18 ? 'body'
        : !crouching && handHeight !== undefined && handHeight > 0.20 ? 'hands' : undefined
      if (candidate !== nextCandidate) {
        candidate = nextCandidate
        candidateStart = time
        candidateSamples = candidate ? 1 : 0
      } else if (candidate) candidateSamples++
      let jump = false
      // Confirm fresh samples without the old 70-90ms gesture delay.
      if (candidate && candidateSamples >= 2 && time - candidateStart >= 12) {
        if (candidate === 'crouch') crouching = true
        else if (armed) {
          jump = true
          armed = false
          jumpSource = candidate
        }
      }
      // Two consecutive upward intervals confirm intent before the full height threshold.
      if (!jump && armed && !crouching && earlyRise) {
        jump = true
        armed = false
        jumpSource = 'body'
      }
      const handsNeutral = handHeight !== undefined ? handHeight < 0.10 : jumpSource !== 'hands'
      const neutralHeight = jumpSource === 'body' ? 0.035 : 0.08
      if (!jump && Math.abs(height) < neutralHeight && handsNeutral && !crouching) {
        neutralStart ??= time
        if (time - neutralStart >= 60) {
          armed = true
          jumpSource = undefined
          roseFromCrouch = false
        }
      } else neutralStart = undefined
      if (suppressGestures) {
        armed = false
        jump = false
        crouching = false
        candidate = undefined
        candidateSamples = 0
        neutralStart = undefined
        jumpSource = undefined
        previousHeight = undefined
        upwardSamples = 0
      }
      const shift = baseline.x - filtered.x
      return {
        status: 'tracking',
        lane: shift < -0.09 ? -1 : shift > 0.09 ? 1 : 0,
        jump,
        crouching,
        height,
        shift,
      }
    },
  }
}
