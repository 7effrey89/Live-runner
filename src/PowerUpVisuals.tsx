import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { laneX } from './gameLogic'
import type { Game } from './gameLogic'
import { avatarScale, playerOffset } from './multiplayer'
import { fireballHeight, SABER_PALETTE, SWORD_SWING_DURATION } from './powerUps'
import type { Fireball } from './powerUps'
import { invincibilityGlow } from './invincibility'
import { routePoint } from './route'

function questionTexture() {
  const rows = ['0111110', '1100011', '0000011', '0000110', '0001100', '0011000', '0011000', '0000000', '0011000']
  const data = new Uint8Array(7 * 9 * 4)
  rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    data.set(pixel === '1' ? [255, 247, 185, 255] : [112, 62, 195, 255], ((8 - y) * 7 + x) * 4)
  }))
  const texture = new THREE.DataTexture(data, 7, 9)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

function boxShadowTexture() {
  const size = 32
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + .5) / (size / 2) - 1, (y + .5) / (size / 2) - 1)
    data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - radius) ** 1.5)], (y * size + x) * 4)
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export function MysteryBox() {
  const root = useRef<THREE.Group>(null)
  const texture = useMemo(() => questionTexture(), [])
  const shadow = useMemo(() => boxShadowTexture(), [])
  useEffect(() => () => { texture.dispose(); shadow.dispose() }, [texture, shadow])
  useFrame(({ clock }) => {
    if (!root.current) return
    root.current.position.y = 2.5 + Math.sin(clock.elapsedTime * 3) * .1
    root.current.rotation.y = clock.elapsedTime * .7
  })
  return <>
    <mesh name="mystery-box-shadow" position={[0, .015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.9, 1.5]} /><meshBasicMaterial map={shadow} color="#08101b" transparent opacity={.55} depthWrite={false} />
    </mesh>
    <group ref={root} position={[0, 2.5, 0]} name="mystery-box">
    <mesh castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial map={texture} emissive="#7943ff" emissiveIntensity={.5} /></mesh>
    <mesh><boxGeometry args={[1.06, 1.06, 1.06]} /><meshBasicMaterial color="#d7f293" wireframe /></mesh>
    <mesh position={[0, -.7, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.45, .035, 6, 20]} /><meshBasicMaterial color="#83dcff" /></mesh>
  </group>
  </>
}

export function RunnerEquipment({ game, course, model, index, count }: {
  game: RefObject<Game>; course: RefObject<Game>; model: THREE.Object3D; index: number; count: number
}) {
  const sword = useRef<THREE.Group>(null)
  const blaster = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  const swordCore = useRef<THREE.MeshBasicMaterial>(null)
  const swordGlow = useRef<THREE.MeshBasicMaterial>(null)
  const white = useMemo(() => new THREE.Color('#ffffff'), [])
  const hand = useMemo(() => {
    const bone = model.getObjectByName('RightHand')
    if (!(bone instanceof THREE.Bone)) throw new Error('Weapon attachment joint missing: RightHand')
    return bone
  }, [model])
  const vectors = useMemo(() => ({
    hand: new THREE.Vector3(), end: new THREE.Vector3(), direction: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), rotation: new THREE.Quaternion(), parentRotation: new THREE.Quaternion(),
  }), [])
  useFrame(() => {
    if (!sword.current || !blaster.current || !beam.current || !sword.current.parent) return
    const g = game.current
    const ability = g.phase === 'running' ? g.ability : undefined
    sword.current.visible = ability?.kind === 'sword'
    blaster.current.visible = ability?.kind === 'blaster'
    beam.current.visible = !!ability?.beam
    if (!ability || ability.kind === 'invisibility') return
    if (ability.kind === 'sword' && swordCore.current && swordGlow.current) {
      swordCore.current.color.set(SABER_PALETTE[ability.saberColor]).lerp(white, .7)
      swordGlow.current.color.set(SABER_PALETTE[ability.saberColor])
    }
    const parent = sword.current.parent
    hand.getWorldPosition(vectors.hand)
    parent.worldToLocal(vectors.hand)
    hand.getWorldQuaternion(vectors.rotation)
    parent.getWorldQuaternion(vectors.parentRotation).invert()
    vectors.rotation.premultiply(vectors.parentRotation)
    sword.current.position.copy(vectors.hand)
    sword.current.quaternion.copy(vectors.rotation)
    if (ability.swing > 0) sword.current.rotateZ(Math.sin((1 - ability.swing / SWORD_SWING_DURATION) * Math.PI) * 2)
    blaster.current.position.copy(vectors.hand)
    if (ability.beam) {
      const target = routePoint(course.current.distance, -ability.beam.distance, laneX(g.lane) + playerOffset(index, count))
      vectors.end.set(target.x, target.y + 1.1 * avatarScale(count), target.z)
      parent.worldToLocal(vectors.end)
      vectors.direction.copy(vectors.end).sub(vectors.hand)
      const length = vectors.direction.length()
      beam.current.position.copy(vectors.hand).add(vectors.end).multiplyScalar(.5)
      beam.current.quaternion.setFromUnitVectors(vectors.up, vectors.direction.normalize())
      beam.current.scale.set(.035, length, .035)
    }
  })
  return <>
    <group ref={sword} name="laser-sword" visible={false}>
      <mesh><cylinderGeometry args={[.065, .065, .25, 8]} /><meshStandardMaterial color="#263a50" metalness={.6} roughness={.3} /></mesh>
      <mesh position={[0, .8, 0]}><cylinderGeometry args={[.045, .045, 1.3, 8]} /><meshBasicMaterial ref={swordCore} color="#d7ffec" /></mesh>
      <mesh position={[0, .8, 0]}><cylinderGeometry args={[.09, .09, 1.4, 8]} /><meshBasicMaterial ref={swordGlow} color="#69ffbc" transparent opacity={.35} depthWrite={false} /></mesh>
    </group>
    <group ref={blaster} name="auto-blaster" visible={false}>
      <mesh><boxGeometry args={[.22, .2, .4]} /><meshStandardMaterial color="#6878b9" /></mesh>
      <mesh position={[0, .04, .35]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.07, .09, .5, 8]} /><meshStandardMaterial color="#83dcff" emissive="#2696d4" emissiveIntensity={.7} /></mesh>
    </group>
    <mesh ref={beam} name="blaster-beam" visible={false}>
      <cylinderGeometry args={[1, 1, 1, 6]} /><meshBasicMaterial color="#b4faff" transparent opacity={.9} depthWrite={false} />
    </mesh>
  </>
}

export function InvincibilityAura({ game, reducedMotion }: { game: RefObject<Game>; reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null)
  const stars = useRef<(THREE.Mesh | null)[]>([])
  useFrame(() => {
    if (!root.current) return
    const g = game.current
    root.current.visible = g.phase === 'running' && g.ability?.kind === 'invisibility'
    if (!root.current.visible) return
    const glow = invincibilityGlow(g.time, reducedMotion)
    stars.current.forEach((star, index) => {
      if (!star) return
      const angle = index * Math.PI / 3 + (reducedMotion ? 0 : g.time * .8)
      star.position.set(Math.sin(angle) * .75, .5 + index % 3 * .55 + (reducedMotion ? 0 : Math.sin(g.time * 2 + index) * .12), Math.cos(angle) * .6)
      star.rotation.set(0, angle, reducedMotion ? .3 : g.time + index)
      if (star.material instanceof THREE.MeshBasicMaterial) star.material.color.setHSL((glow.hue + index / 6) % 1, .6, .75)
    })
  })
  return <group ref={root} name="invincibility-aura" visible={false}>
    {Array.from({ length: 6 }, (_, index) => <mesh key={index} ref={mesh => { stars.current[index] = mesh }}>
      <octahedronGeometry args={[.09]} /><meshBasicMaterial color="#ffec89" />
    </mesh>)}
    <mesh position={[0, .08, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.65, .05, 6, 24]} /><meshBasicMaterial color="#ffe7a0" transparent opacity={.5} depthWrite={false} /></mesh>
  </group>
}

function FireballMesh({ projectile, game, course, id, index, count }: {
  projectile: Fireball; game: RefObject<Game>; course: RefObject<Game>; id: number; index: number; count: number
}) {
  const root = useRef<THREE.Group>(null)
  const launch = useMemo(() => new THREE.Vector3(), [])
  const launchCaptured = useRef(false)
  useFrame(({ scene }, delta) => {
    if (!root.current) return
    const ability = game.current.ability
    const live = game.current.phase === 'running' && ability?.kind === 'fireball' ? ability.fireballs.find(ball => ball.id === projectile.id) : undefined
    root.current.visible = !!live
    if (!live) return
    if (!launchCaptured.current) {
      const runner = scene.getObjectByName(id === 0 ? 'runner-root' : `runner-root-${id}`)
      const hand = runner?.getObjectByName(live.hand === 'left' ? 'LeftHand' : 'RightHand')
      if (!(hand instanceof THREE.Bone)) throw new Error('Fireball launch hand is unavailable')
      hand.getWorldPosition(launch)
      launchCaptured.current = true
    }
    const scale = avatarScale(count)
    const lateral = laneX(live.lane) + playerOffset(index, count) + (live.hand === 'left' ? -.35 : .35) * scale * Math.exp(-live.age * 10)
    const point = routePoint(course.current.distance, live.z, lateral)
    root.current.position.set(point.x, point.y + fireballHeight(live) * scale, point.z)
    root.current.position.lerp(launch, Math.max(0, 1 - live.age / .18))
    root.current.rotation.y = point.heading
    root.current.rotation.z += Math.min(delta, .05) * 5
  })
  return <group ref={root} name={`fireball-${id}-${projectile.id}`} scale={avatarScale(count)}>
    <mesh><sphereGeometry args={[.19, 12, 8]} /><meshBasicMaterial color="#fff4af" /></mesh>
    <mesh><sphereGeometry args={[.31, 12, 8]} /><meshBasicMaterial color="#ff762d" transparent opacity={.5} depthWrite={false} /></mesh>
    {[.35, .6].map((z, index) => <mesh key={z} position={[0, 0, z]}><sphereGeometry args={[.14 - index * .04, 8, 6]} /><meshBasicMaterial color="#ffad38" transparent opacity={.6 - index * .2} depthWrite={false} /></mesh>)}
  </group>
}

export function FireballProjectiles({ projectiles, ...props }: {
  projectiles: readonly Fireball[]; game: RefObject<Game>; course: RefObject<Game>; id: number; index: number; count: number
}) {
  return <group name={`fireballs-${props.id}`}>{projectiles.map(projectile => <FireballMesh key={projectile.id} projectile={projectile} {...props} />)}</group>
}
