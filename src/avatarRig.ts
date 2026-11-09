import * as THREE from 'three'
import { getAvatarPose } from './avatarPose.ts'
import type { AvatarFrame, Direction, PoseBone } from './avatarPose.ts'

const children: Record<PoseBone, string> = {
  Spine: 'Chest', Head: 'Head_end',
  LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand',
  RightArm: 'RightForeArm', RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToes',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToes',
}

const slideDirections: Partial<Record<PoseBone, Direction>> = {
  Spine: [0, .65, -.76],
  LeftArm: [-.3, -.88, -.3], RightArm: [.3, -.88, -.3],
  LeftForeArm: [0, -.9, .35], RightForeArm: [0, -.9, .35],
  LeftUpLeg: [-.1, -.12, .99], LeftLeg: [0, -.08, 1], LeftFoot: [0, 0, 1],
  RightUpLeg: [.2, -.12, .98], RightLeg: [.1, -.25, -.96], RightFoot: [0, 0, 1],
}

export function createAvatarRig(model: THREE.Object3D) {
  const bones = new Map<PoseBone, {
    bone: THREE.Bone; axis: THREE.Vector3; rest: THREE.Quaternion
    base: THREE.Quaternion; previous: THREE.Quaternion
  }>()
  for (const name of Object.keys(children) as PoseBone[]) {
    const bone = model.getObjectByName(name)
    const child = model.getObjectByName(children[name])
    if (!(bone instanceof THREE.Bone) || !(child instanceof THREE.Bone)) throw new Error(`Character pose joint missing: ${name}`)
    bones.set(name, {
      bone, axis: child.position.clone().normalize(), rest: bone.quaternion.clone(),
      base: bone.quaternion.clone(), previous: bone.quaternion.clone(),
    })
  }
  const modelRotation = new THREE.Quaternion()
  const parentRotation = new THREE.Quaternion()
  const target = new THREE.Quaternion()
  const turn = new THREE.Quaternion()
  const parentInverse = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const vector = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const foot = new THREE.Vector3()
  let applied = false
  let slideBlend = 0
  const footY = () => Math.min(...(['LeftFoot', 'RightFoot'] as const).map(name => bones.get(name)!.bone.getWorldPosition(foot).y))
  const parentInModel = (bone: THREE.Bone) => {
    if (!bone.parent) throw new Error(`Character pose joint has no parent: ${bone.name}`)
    bone.parent.getWorldQuaternion(parentRotation)
    parentRotation.premultiply(modelRotation).invert()
  }
  return {
    restore() {
      // Remove the previous pose layer before advancing the animation mixer.
      if (applied) bones.forEach(({ bone, base }) => bone.quaternion.copy(base))
    },
    apply(frame: AvatarFrame | undefined, facingViewer: boolean, sliding: boolean, delta: number, fallen = false, visualScale = 1) {
      const pose = getAvatarPose(frame, facingViewer, performance.now())
      const slide = sliding && !facingViewer
      slideBlend = THREE.MathUtils.damp(slideBlend, slide ? 1 : 0, 1 / .018, delta)
      const crouch = fallen ? Math.max(0.75, pose.crouch) : facingViewer ? pose.crouch : 0
      const alpha = 1 - Math.exp(-delta / 0.018)
      model.updateWorldMatrix(true, true)
      model.getWorldQuaternion(modelRotation).invert()
      const before = footY()
      for (const [name, entry] of bones) {
        const { bone, base, previous, rest } = entry
        base.copy(bone.quaternion)
        target.copy(base)
        parentInModel(bone)
        const direction = slide ? slideDirections[name]
          : !facingViewer && (name.includes('Leg') || name.includes('Foot')) ? undefined : pose.directions[name]
        if (direction) {
          vector.fromArray(direction).applyQuaternion(parentRotation).normalize()
          axis.copy(entry.axis).applyQuaternion(rest)
          target.setFromUnitVectors(axis, vector).multiply(rest)
        }
        let rotation: Direction | undefined
        if (name === 'Head') rotation = slide ? [.2, 0, 0] : pose.head
        if (crouch > 0) {
          if (name === 'Spine') rotation = [0.25 * crouch, 0, 0]
          if (!direction) {
            if (name.endsWith('UpLeg')) rotation = [-0.85 * crouch, 0, 0]
            else if (name.endsWith('Leg')) rotation = [1.7 * crouch, 0, 0]
            else if (name.endsWith('Foot')) rotation = [-0.85 * crouch, 0, 0]
          }
        }
        if (rotation) {
          turn.setFromEuler(euler.set(...rotation))
          parentInverse.copy(parentRotation).invert()
          turn.premultiply(parentRotation).multiply(parentInverse)
          target.premultiply(turn)
        }
        previous.slerp(target, alpha)
        bone.quaternion.copy(previous)
        bone.updateWorldMatrix(false, true)
      }
      applied = true
      // Bring the sliding soles down to the road surface, not the standing ankle height.
      const lower = THREE.MathUtils.clamp(before - footY() - .12 * slideBlend, -.95 * visualScale, 0)
      return { lower, shift: pose.shift, lift: pose.lift }
    },
  }
}
