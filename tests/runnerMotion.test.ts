import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { JUMP_DURATION, JUMP_HEIGHT, JUMP_BLEND, JUMP_START_FRACTION, JUMP_RISE_DURATION, JUMP_APEX_END, jumpHeight, clearsBarrier } from '../src/runnerMotion.ts'
import { getAvatarPose } from '../src/avatarPose.ts'
import type { AvatarFrame } from '../src/avatarPose.ts'
import { createAvatarRig } from '../src/avatarRig.ts'

function frame(): AvatarFrame {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }))
  pose[11] = { x: 0.65, y: 0.4, visibility: 1 }
  pose[13] = { x: 0.75, y: 0.3, visibility: 1 }
  pose[15] = { x: 0.8, y: 0.15, visibility: 1 }
  pose[12] = { x: 0.35, y: 0.4, visibility: 1 }
  pose[14] = { x: 0.3, y: 0.55, visibility: 1 }
  pose[16] = { x: 0.25, y: 0.7, visibility: 1 }
  return { pose, worldPose: [], aspectRatio: 4 / 3, time: performance.now(), height: 0, shift: 0 }
}

test('short jump has grounded endpoints, a lower peak, and height-based barrier clearance', () => {
  assert.equal(JUMP_DURATION, 0.48)
  assert.equal(JUMP_BLEND, 0.035)
  assert.equal(JUMP_START_FRACTION, 0.12)
  assert.equal(jumpHeight(0), 0)
  assert.equal(jumpHeight(JUMP_DURATION), 0)
  assert.equal(jumpHeight(-1), 0)
  assert.equal(jumpHeight(JUMP_DURATION - JUMP_RISE_DURATION), JUMP_HEIGHT)
  assert.equal(jumpHeight(JUMP_DURATION - JUMP_APEX_END), JUMP_HEIGHT)
  for (let t = 0; t <= JUMP_DURATION; t += 0.005) assert.equal(clearsBarrier(t), jumpHeight(t) > 1)
  assert.equal(clearsBarrier(0.01), false)
  assert.equal(clearsBarrier(JUMP_DURATION / 2), true)
})

test('fast takeoff clears barriers within 50ms and holds a short, continuous apex', () => {
  assert.equal(clearsBarrier(JUMP_DURATION - .04), false)
  assert.equal(clearsBarrier(JUMP_DURATION - .05), true)
  for (let age = JUMP_RISE_DURATION; age <= JUMP_APEX_END; age += .005) assert.equal(jumpHeight(JUMP_DURATION - age), JUMP_HEIGHT)
  for (let age = .001; age < JUMP_DURATION; age += .001) {
    assert.ok(Math.abs(jumpHeight(JUMP_DURATION - age) - jumpHeight(JUMP_DURATION - age + .001)) < .025)
  }
  assert.ok(jumpHeight(.001) < .01)
})

test('upper-body waves mirror in the front preview and follow anatomical sides during runs', () => {
  const input = frame()
  const front = getAvatarPose(input, true, input.time)
  const back = getAvatarPose(input, false, input.time)
  assert.ok(front.directions.RightArm![0] < 0 && front.directions.RightArm![1] > 0)
  assert.ok(back.directions.LeftArm![0] > 0 && back.directions.LeftArm![1] > 0)
  assert.ok(front.directions.LeftArm![1] < 0)
  assert.equal(front.directions.LeftLeg, undefined)
})

test('3D landmarks preserve arm depth, while missing joints and stale frames return to animation', () => {
  const input = frame()
  input.worldPose = input.pose.map(p => ({ ...p, z: 0 }))
  input.worldPose[13].z = -0.3
  assert.ok(getAvatarPose(input, false, input.time).directions.LeftArm![2] > 0)
  input.pose[13].visibility = 0
  assert.equal(getAvatarPose(input, false, input.time).directions.LeftArm, undefined)
  assert.deepEqual(getAvatarPose(input, false, input.time + 251).directions, {})
  assert.deepEqual(getAvatarPose(undefined, true, input.time).directions, {})
})

test('head turns, continuous crouching, and body shifts follow camera motion without legs', () => {
  const input = frame()
  input.pose[7] = { x: 0.55, y: 0.2, visibility: 1 }
  input.pose[8] = { x: 0.45, y: 0.2, visibility: 1 }
  input.pose[0] = { x: 0.54, y: 0.23, visibility: 1 }
  input.height = -0.325
  input.shift = 0.05
  const pose = getAvatarPose(input, true, input.time)
  assert.equal(pose.crouch, 0.5)
  assert.equal(pose.shift, 0.25)
  assert.ok(pose.head![1] < 0)
})

test('visible hips and knees drive torso and leg motion, without changing the upper-body fallback', () => {
  const input = frame()
  input.pose[23] = { x: 0.55, y: 0.7, visibility: 1 }
  input.pose[25] = { x: 0.65, y: 0.8, visibility: 1 }
  input.pose[27] = { x: 0.55, y: 0.95, visibility: 1 }
  input.pose[24] = { x: 0.25, y: 0.7, visibility: 1 }
  const full = getAvatarPose(input, false, input.time)
  assert.ok(full.directions.LeftUpLeg![0] > 0 && full.directions.LeftUpLeg![1] < 0)
  assert.ok(full.directions.LeftLeg![0] < 0)
  assert.ok(full.directions.Spine![0] > 0)
  input.pose[23].visibility = 0
  assert.equal(getAvatarPose(input, false, input.time).directions.LeftUpLeg, undefined)
  assert.ok(getAvatarPose(input, false, input.time).directions.LeftArm)
})

test('joint posing bends knees without scaling and restores animation before the next frame', () => {
  const model = new THREE.Group()
  const add = (name: string, child: string, parent: THREE.Object3D) => {
    const existing = model.getObjectByName(name)
    const bone = existing instanceof THREE.Bone ? existing : new THREE.Bone()
    bone.name = name
    const tip = new THREE.Bone(); tip.name = child; tip.position.y = name.includes('Leg') ? -0.3 : 0.3
    if (!bone.parent) parent.add(bone)
    bone.add(tip)
    return tip
  }
  add('Head', 'Head_end', add('Spine', 'Chest', model))
  for (const side of ['Left', 'Right']) {
    add(`${side}ForeArm`, `${side}Hand`, add(`${side}Arm`, `${side}ForeArm`, model))
    add(`${side}Foot`, `${side}Toes`, add(`${side}Leg`, `${side}Foot`, add(`${side}UpLeg`, `${side}Leg`, model)))
  }
  const rig = createAvatarRig(model)
  const input = frame(); input.height = -0.65
  rig.apply(input, true, true, 1)
  const knee = model.getObjectByName('LeftLeg')!
  assert.ok(knee.quaternion.angleTo(new THREE.Quaternion()) > 0.5)
  assert.deepEqual(model.scale.toArray(), [1, 1, 1])
  rig.restore()
  assert.ok(knee.quaternion.angleTo(new THREE.Quaternion()) < 1e-6)
  assert.throws(() => createAvatarRig(new THREE.Group()), /joint missing/)
})
