import { JUMP_APEX_END, JUMP_DURATION, JUMP_HEIGHT, JUMP_RISE_DURATION } from './runnerMotion.ts'

export const DEFAULT_DIFFICULTY = 1
export const JUMP_CLEAR_START = Math.asin(1 / JUMP_HEIGHT) * 2 / Math.PI * JUMP_RISE_DURATION
export const JUMP_CLEAR_END = JUMP_APEX_END + Math.acos(1 / JUMP_HEIGHT) * 2 / Math.PI * (JUMP_DURATION - JUMP_APEX_END)

export function jumpTiming(difficulty: number) {
  if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 2) throw new RangeError('Difficulty must be between 0 (Easy) and 2 (Hard)')
  const allowance = (2 - difficulty) * .1
  const start = Math.max(0, JUMP_CLEAR_START - allowance)
  const end = JUMP_CLEAR_END + allowance
  const label = difficulty === 0 ? 'Easy' : difficulty === 1 ? 'Normal' : difficulty === 2 ? 'Hard'
    : difficulty < 1 ? 'Easy / Normal' : 'Normal / Hard'
  return { allowance, start, end, window: end - start + allowance, label }
}
