import { isVisiblePoint } from './bodyTracking.ts'
import type { BodyPoint } from './bodyTracking.ts'

export type PosePoint = BodyPoint & { z?: number }
export type AvatarFrame = {
  pose: readonly PosePoint[]; worldPose: readonly PosePoint[]; time: number
  aspectRatio: number; height: number; shift: number
}
export type PoseBone = 'Spine' | 'Head' | 'LeftArm' | 'LeftForeArm' | 'RightArm' | 'RightForeArm'
  | 'LeftUpLeg' | 'LeftLeg' | 'LeftFoot' | 'RightUpLeg' | 'RightLeg' | 'RightFoot'
export type Direction = [number, number, number]

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))

export function getAvatarPose(frame: AvatarFrame | undefined, facingViewer: boolean, now: number) {
  const directions: Partial<Record<PoseBone, Direction>> = {}
  if (!frame || now - frame.time > 250) return { directions, crouch: 0, shift: 0, lift: 0, head: undefined }
  const { pose, worldPose, aspectRatio } = frame
  // Front views mirror the preview; back views retain anatomical left/right.
  const xSign = facingViewer ? -1 : 1
  const direction = (from: number, to: number): Direction | undefined => {
    if (!isVisiblePoint(pose[from]) || !isVisiblePoint(pose[to])) return
    const a = worldPose[from], b = worldPose[to]
    const world = a && b && [a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)
    const vector: Direction = world
      ? [(b.x - a.x) * xSign, a.y - b.y, a.z! - b.z!]
      : [(pose[to].x - pose[from].x) * aspectRatio * xSign, pose[from].y - pose[to].y, 0]
    const length = Math.hypot(...vector)
    if (length < 0.0001) return
    return [vector[0] / length, vector[1] / length, vector[2] / length]
  }
  for (const side of ['Left', 'Right'] as const) {
    const leftInput = facingViewer ? side === 'Right' : side === 'Left'
    const shoulder = leftInput ? 11 : 12
    directions[`${side}Arm`] = direction(shoulder, shoulder + 2)
    directions[`${side}ForeArm`] = direction(shoulder + 2, shoulder + 4)
    const hip = leftInput ? 23 : 24
    directions[`${side}UpLeg`] = direction(hip, hip + 2)
    directions[`${side}Leg`] = direction(hip + 2, hip + 4)
  }
  if (isVisiblePoint(pose[11]) && isVisiblePoint(pose[12])) {
    const width = Math.max(0.08, Math.abs(pose[11].x - pose[12].x) * aspectRatio)
    const roll = clamp(Math.atan2(pose[11].y - pose[12].y, width) * -xSign, 0.5)
    directions.Spine = [-Math.sin(roll), Math.cos(roll), 0]
    const leftTorso = direction(23, 11), rightTorso = direction(24, 12)
    if (leftTorso && rightTorso) {
      const axis: Direction = [leftTorso[0] + rightTorso[0], leftTorso[1] + rightTorso[1], leftTorso[2] + rightTorso[2]]
      const length = Math.hypot(...axis)
      if (length > 0.0001) directions.Spine = [axis[0] / length, axis[1] / length, axis[2] / length]
    }
  }
  let head: Direction | undefined
  if (isVisiblePoint(pose[0]) && isVisiblePoint(pose[7]) && isVisiblePoint(pose[8])) {
    const left = pose[7], right = pose[8], nose = pose[0]
    const width = Math.max(0.025, Math.abs(left.x - right.x))
    head = [
      0,
      clamp(Math.atan2((nose.x - (left.x + right.x) / 2) * xSign, width * 0.6), 0.85),
      clamp(Math.atan2(left.y - right.y, width * aspectRatio) * -xSign, 0.45),
    ]
  }
  return {
    directions, head,
    crouch: Math.max(0, Math.min(1, -frame.height / 0.65)),
    shift: clamp(frame.shift * 5, 0.55),
    lift: Math.max(0, Math.min(0.4, frame.height * 0.4)),
  }
}
