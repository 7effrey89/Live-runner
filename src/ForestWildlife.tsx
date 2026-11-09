import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { RefObject } from 'react'
import type * as THREE from 'three'
import { birdMotion, GROUND_ANIMALS, groundAnimalMotion } from './wildlifeMotion'
import type { Game } from './gameLogic'
import { routePoint, waterSpan } from './route'

type WildlifeGame = RefObject<Pick<Game, 'distance' | 'phase' | 'speed'>>
type Vector = [number, number, number]

export function Part({ position, scale, color, shape = 'sphere', rotation }: {
  position: Vector; scale: Vector; color: string; shape?: 'sphere' | 'cone' | 'box'; rotation?: Vector
}) {
  return <mesh position={position} scale={scale} rotation={rotation}>
    {shape === 'sphere' ? <sphereGeometry args={[1, 8, 6]} /> : shape === 'cone' ? <coneGeometry args={[1, 1, 5]} /> : <boxGeometry args={[2, 2, 2]} />}
    <meshStandardMaterial color={color} flatShading roughness={0.9} />
  </mesh>
}

function GroundAnimal({ index, game }: { index: number; game: WildlifeGame }) {
  const root = useRef<THREE.Group>(null)
  const legs = useRef<(THREE.Group | null)[]>([])
  const travel = useRef({ cycle: -1, distance: 0, z: 0, previousDistance: 0 })
  const animal = GROUND_ANIMALS[index]
  const { kind } = animal
  const deer = kind === 'deer', frog = kind === 'frog', mouse = kind === 'mouse'
  const color = deer ? '#ac784f' : frog ? '#80bd48' : mouse ? '#b5a6ad' : '#e3d4bc'
  const legHeight = deer ? 0.65 : frog ? 0.09 : mouse ? 0.08 : 0.22
  const bodyY = legHeight + (deer ? 0.22 : frog || mouse ? 0.11 : 0.2)
  const spanX = deer ? 0.42 : frog ? 0.14 : mouse ? 0.12 : 0.2
  const spanZ = deer ? 0.2 : 0.12
  useFrame(({ clock }) => {
    if (!root.current) return
    const motion = groundAnimalMotion(index, clock.elapsedTime)
    const g = game.current
    const state = travel.current
    if (state.cycle !== motion.cycle || g.distance < state.previousDistance) {
      state.cycle = motion.cycle
      state.distance = g.distance
      // Aim the crossing's midpoint down the road, then scroll with the forest.
      state.z = -animal.depth - (g.phase === 'running' ? g.speed : 0) * (animal.duration / 2 - motion.elapsed)
    }
    state.previousDistance = g.distance
    const z = state.z + g.distance - state.distance
    const point = routePoint(g.distance, z, motion.x)
    const wet = waterSpan(g.distance - z)
    root.current.visible = motion.visible && z < -5 && z > -125 && !(wet && motion.x >= wet[0] && motion.x <= wet[1])
    root.current.position.set(point.x, point.y + motion.hop, point.z)
    root.current.rotation.y = point.heading + (animal.direction > 0 ? 0 : Math.PI)
    legs.current.forEach((leg, i) => {
      if (leg) leg.rotation.z = motion.gait * (frog ? 0.7 : 0.55) * (kind === 'rabbit' ? i < 2 ? 1 : -1 : i % 3 === 0 ? 1 : -1)
    })
  })
  return <group ref={root} name={`wildlife-${kind}-${index}`} visible={false} scale={mouse ? 0.7 : kind === 'rabbit' ? 0.8 : 1}>
    <Part position={[0, bodyY, 0]} scale={deer ? [0.58, 0.25, 0.25] : frog ? [0.22, 0.12, 0.18] : mouse ? [0.22, 0.13, 0.12] : [0.3, 0.23, 0.2]} color={color} />
    {[0, 1, 2, 3].map(i => <group key={i} ref={node => { legs.current[i] = node }} position={[i < 2 ? spanX : -spanX, legHeight, i % 2 ? spanZ : -spanZ]}>
      <Part position={[0, -legHeight / 2, 0]} scale={[deer ? 0.055 : 0.04, legHeight / 2, 0.04]} color={color} />
      <Part position={[0.025, -legHeight + 0.025, 0]} scale={[frog ? 0.08 : 0.055, 0.025, 0.045]} color={deer ? '#453d36' : color} />
    </group>)}
    {frog ? <>
      {[-1, 1].map(side => <group key={side} position={[0.1, 0.27, side * 0.13]}>
        <Part position={[0, 0, 0]} scale={[0.08, 0.08, 0.065]} color="#f4f0b8" />
        <Part position={[0.055, 0.005, side * 0.03]} scale={[0.025, 0.038, 0.025]} color="#182b25" />
      </group>)}
      <Part position={[0.2, 0.15, 0]} scale={[0.015, 0.015, 0.12]} color="#376d36" shape="box" />
    </> : <>
      {deer && <Part position={[0.43, 1.12, 0]} scale={[0.13, 0.38, 0.14]} color={color} rotation={[0, 0, -0.3]} />}
      <group position={[deer ? 0.6 : 0.23, deer ? 1.42 : mouse ? 0.24 : 0.54, 0]}>
        <Part position={[0, 0, 0]} scale={deer ? [0.23, 0.17, 0.15] : mouse ? [0.12, 0.1, 0.1] : [0.18, 0.16, 0.14]} color={color} />
        <Part position={[deer ? 0.21 : mouse ? 0.11 : 0.15, -0.025, 0]} scale={[0.04, 0.035, 0.045]} color={mouse ? '#e9a4ad' : '#493c36'} />
        {[-1, 1].map(side => <group key={side}>
          <Part position={[0.065, 0.035, side * (deer ? 0.142 : mouse ? 0.082 : 0.13)]} scale={[0.022, 0.025, 0.012]} color="#182329" />
          <Part position={[-0.05, deer ? 0.15 : mouse ? 0.1 : 0.23, side * 0.1]} scale={deer ? [0.14, 0.045, 0.07] : mouse ? [0.07, 0.08, 0.045] : [0.06, 0.23, 0.05]} color={mouse ? '#dda5ab' : color} rotation={[0, 0, deer ? side * 0.3 : 0]} />
          {deer && <>
            <Part position={[-0.04, 0.32, side * 0.09]} scale={[0.035, 0.42, 0.035]} color="#dcc9a0" shape="cone" rotation={[0, 0, 0.25]} />
            <Part position={[-0.11, 0.32, side * 0.09]} scale={[0.025, 0.2, 0.025]} color="#dcc9a0" shape="cone" rotation={[0, 0, 0.85]} />
          </>}
        </group>)}
      </group>
      <Part position={[deer ? -0.58 : mouse ? -0.36 : -0.3, bodyY, 0]} scale={mouse ? [0.018, 0.32, 0.018] : [0.075, 0.075, 0.075]} color={mouse ? '#dda5ab' : deer ? '#ead7b5' : '#f8eedc'} shape={mouse ? 'cone' : 'sphere'} rotation={mouse ? [0, 0, Math.PI / 2] : undefined} />
    </>}
  </group>
}

function Bird({ index, game }: { index: number; game: WildlifeGame }) {
  const root = useRef<THREE.Group>(null)
  const wings = useRef<(THREE.Group | null)[]>([])
  useFrame(({ clock }) => {
    if (!root.current) return
    const motion = birdMotion(index, clock.elapsedTime)
    const point = routePoint(game.current.distance, motion.z, motion.x)
    root.current.position.set(point.x, motion.y, point.z)
    root.current.rotation.y = motion.heading + point.heading
    wings.current.forEach((wing, side) => { if (wing) wing.rotation.x = motion.flap * (side ? -1 : 1) })
  })
  const color = index % 2 ? '#b9cddd' : '#e8d8b7'
  return <group ref={root} name={`wildlife-bird-${index}`} scale={1.3}>
    <Part position={[0, 0, 0]} scale={[0.3, 0.13, 0.12]} color={color} />
    <Part position={[0.23, 0.09, 0]} scale={[0.13, 0.12, 0.11]} color={color} />
    {[-1, 1].map(side => <Part key={side} position={[0.28, 0.12, side * 0.1]} scale={[0.015, 0.018, 0.012]} color="#182329" />)}
    <Part position={[0.37, 0.08, 0]} scale={[0.05, 0.15, 0.05]} color="#e3ad54" shape="cone" rotation={[0, 0, -Math.PI / 2]} />
    <Part position={[-0.3, 0, 0]} scale={[0.18, 0.025, 0.13]} color={color} shape="box" />
    {[0, 1].map(side => <group key={side} ref={node => { wings.current[side] = node }} position={[0, 0.035, side ? -0.1 : 0.1]}>
      <Part position={[-0.04, 0, side ? -0.3 : 0.3]} scale={[0.22, 0.035, 0.35]} color={color} shape="box" rotation={[0, side ? -0.2 : 0.2, 0]} />
    </group>)}
  </group>
}

export function ForestWildlife({ game }: { game: WildlifeGame }) {
  return <group name="forest-wildlife">
    {GROUND_ANIMALS.map((_, index) => <GroundAnimal key={index} index={index} game={game} />)}
    {Array.from({ length: 5 }, (_, index) => <Bird key={index} index={index} game={game} />)}
  </group>
}
