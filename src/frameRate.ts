function validateTime(time: number, previous: number) {
  if (!Number.isFinite(time) || time < previous) throw new RangeError('Frame-rate timestamps must be finite, non-negative and monotonic')
}

export function createFrameRateCounter(startTime: number) {
  validateTime(startTime, 0)
  let start = startTime
  let frames = 0
  return {
    record() {
      frames++
    },
    sample(time: number) {
      validateTime(time, start)
      const elapsed = time - start
      if (elapsed === 0) return undefined
      const fps = frames * 1000 / elapsed
      frames = 0
      start = time
      return fps
    },
    reset(time: number) {
      validateTime(time, start)
      frames = 0
      start = time
    },
  }
}
