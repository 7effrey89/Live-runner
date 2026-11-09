export const JUMP_DURATION = 0.48
export const JUMP_HEIGHT = 1.65
export const JUMP_START_FRACTION = 0.12
export const JUMP_BLEND = 0.035
export const JUMP_RISE_DURATION = 0.12
export const JUMP_APEX_END = 0.20
export const JUMP_BUFFER_DURATION = 0.10

export function jumpHeight(remaining: number) {
  if (remaining <= 0 || remaining >= JUMP_DURATION) return 0
  const age = JUMP_DURATION - remaining
  if (age < JUMP_RISE_DURATION) return Math.sin(age / JUMP_RISE_DURATION * Math.PI / 2) * JUMP_HEIGHT
  if (age <= JUMP_APEX_END) return JUMP_HEIGHT
  return Math.cos((age - JUMP_APEX_END) / (JUMP_DURATION - JUMP_APEX_END) * Math.PI / 2) * JUMP_HEIGHT
}

export function clearsBarrier(remaining: number) {
  return jumpHeight(remaining) > 1
}
