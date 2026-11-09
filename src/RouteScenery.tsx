import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Part } from './ForestWildlife'
import type { Game } from './gameLogic'
import { roadColor, routeArea, routeElevation, routePoint, waterSpan } from './route'
import { ROUTE_ASSETS } from './routeAssets'
import type { RouteAsset } from './routeAssets'
import type { TimeOfDay } from './scenery'

type RouteGame = RefObject<Pick<Game, 'distance' | 'phase' | 'speed'>>
type Models = ReadonlyMap<RouteAsset, GLTF>
type Vector = [number, number, number]
const SEGMENTS = 96

function stripGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 6), 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 6), 3))
  const indices = []
  for (let i = 0; i < SEGMENTS; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  geometry.setIndex(indices)
  return geometry
}

function RouteStrip({ game, span, daylight, type = 'road' }: {
  game: RouteGame; span: [number, number]; daylight: boolean; type?: 'road' | 'line' | 'ground' | 'water'
}) {
  const geometry = useMemo(() => stripGeometry(), [])
  const waterUniforms = useMemo(() => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    time: { value: 0 }, tint: { value: new THREE.Color(daylight ? '#58b9c6' : '#286879') },
  }]), [daylight])
  const water = useRef<THREE.ShaderMaterial>(null)
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(({ clock }) => {
    const distance = game.current.distance
    const position = geometry.getAttribute('position')
    const color = geometry.getAttribute('color')
    for (let i = 0; i <= SEGMENTS; i++) {
      const z = 20 - i * 180 / SEGMENTS
      const area = routeArea(distance - z)
      const edges = type === 'water' ? waterSpan(distance - z) ?? [0, 0] : span
      const rgb = type === 'line' ? [.45, .75, .71] : type === 'ground'
        ? (area.kind === 'town' ? [.53, .49, .40] : [.28, .43, .25]).map(channel => channel * (daylight ? 1 : .48))
        : roadColor(area.kind, daylight)
      for (let side = 0; side < 2; side++) {
        const point = routePoint(distance, z, edges[side])
        const y = type === 'water' ? -.16 : type === 'ground' ? -.18 : point.y + (type === 'line' ? -.10 : area.kind === 'bridge' ? -.25 : -.13)
        position.setXYZ(i * 2 + side, point.x, y, point.z)
        color.setXYZ(i * 2 + side, rgb[0], rgb[1], rgb[2])
      }
    }
    position.needsUpdate = true
    color.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    if (water.current) water.current.uniforms.time.value = clock.elapsedTime
  }, -0.5)
  return <mesh name={`route-${type}-${span[0]}`} geometry={geometry} receiveShadow={type === 'road'}>
    {type === 'water' ? <shaderMaterial ref={water} fog side={THREE.DoubleSide} uniforms={waterUniforms} vertexShader={`varying vec3 world; uniform float time;
      #include <fog_pars_vertex>
      void main(){vec3 p=position;p.y+=sin(p.z*.45+time*1.5)*.006;world=p;vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`}
      fragmentShader={`varying vec3 world;uniform float time;uniform vec3 tint;
        #include <fog_pars_fragment>
        void main(){float ripple=sin(world.x*2.+world.z*.7+time*2.)*sin(world.z*1.8-time);
        gl_FragColor=vec4(tint+vec3(.045)*ripple,1.);
        #include <fog_fragment>
        #include <colorspace_fragment>
        }`} />
      : type === 'line' ? <meshBasicMaterial vertexColors />
        : <meshStandardMaterial vertexColors roughness={type === 'road' ? .9 : 1} />}
  </mesh>
}

function Model({ models, asset, position = [0, 0, 0], scale = 1, rotation = [0, 0, 0] }: {
  models: Models; asset: RouteAsset; position?: Vector; scale?: number | Vector; rotation?: Vector
}) {
  const object = useMemo(() => {
    const source = models.get(asset)
    if (!source) throw new Error(`Missing route model: ${asset}`)
    const copy = source.scene.clone(true)
    copy.traverse(node => {
      if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true }
    })
    return copy
  }, [models, asset])
  return <primitive object={object} position={position} scale={scale} rotation={rotation} dispose={null} />
}

function House({ models, variant }: { models: Models; variant: number }) {
  const blades = useRef<THREE.Group>(null)
  const floors = variant === 1 ? 1 : 2
  useFrame(({ clock }) => { if (blades.current) blades.current.rotation.x = clock.elapsedTime * .45 })
  return <group scale={2.6}>
    {Array.from({ length: floors }, (_, floor) => [0, 1, 2, 3].flatMap(side => [-.5, .5].map((offset, column) =>
      <group key={`${floor}-${side}-${column}`} position={side < 2 ? [side ? -.55 : .55, floor, offset] : [offset, floor, side === 2 ? .55 : -.55]} rotation={[0, [0, Math.PI, -Math.PI / 2, Math.PI / 2][side], 0]}>
        <Model models={models} asset={floor === 0 && side === 2 && column === 0 ? 'town/wall-wood-door' : 'town/wall-wood-window-shutters'} />
      </group>)))}
    <Model models={models} asset="town/roof-point" position={[0, floors, 0]} scale={2} />
    <Model models={models} asset="town/chimney" position={[.45, floors + .25, -.3]} scale={.7} />
    {variant === 2 && <group position={[0, floors, 1.08]} rotation={[0, -Math.PI / 2, 0]}>
      <group ref={blades}><Model models={models} asset="town/windmill" scale={.55} /></group>
    </group>}
  </group>
}

function Decoration({ game, models, absolute, side }: { game: RouteGame; models: Models; absolute: number; side: number }) {
  const root = useRef<THREE.Group>(null)
  const area = routeArea(absolute)
  const index = Math.floor(absolute / 24)
  useFrame(() => {
    if (!root.current) return
    const pond = area.kind === 'park' && side > 0 ? waterSpan(absolute) : undefined
    const lateral = pond ? pond[0] - 2.5 : side * (area.kind === 'town' ? 9 : 8.5)
    const point = routePoint(game.current.distance, game.current.distance - absolute, lateral)
    root.current.position.set(point.x, 0, point.z)
    root.current.rotation.y = point.heading
  })
  if (area.kind === 'bridge' || (area.kind === 'lake' && side > 0)) return null
  return <group ref={root} name={`route-decoration-${absolute}-${side}`}>
    {area.kind === 'town' ? index % 3 === 0 ? <group rotation={[0, -side * Math.PI / 2, 0]}><House models={models} variant={(index + area.variant) % 3} /></group>
      : index % 3 === 1 ? <><Model models={models} asset={index % 2 ? 'town/stall-red' : 'town/stall-green'} scale={2.8} /><Model models={models} asset="town/cart" position={[side * 3, 0, 3]} scale={2} /></>
        : <><Model models={models} asset="town/tree-high-round" scale={2.2} /><Model models={models} asset="town/lantern" position={[-side * 2.5, 0, 3]} scale={2.3} /></>
      : area.kind === 'park' ? <>
        <Model models={models} asset="town/tree-high-round" scale={2 + index % 3 * .25} />
        <Model models={models} asset="town/stall-bench" position={[-side * 2, 0, 3]} scale={3} rotation={[0, Math.PI / 2, 0]} />
        {index % 3 === 0 && (side < 0 || !waterSpan(absolute)) && <Model models={models} asset="town/fountain-round" position={[side * 4, 0, 0]} scale={2.2} />}
        <Model models={models} asset="town/hedge" position={[-side * 2.5, 0, -4]} scale={2.6} />
      </> : <>
        <Model models={models} asset={index % 2 ? 'mini-forest/tree-high' : 'mini-forest/tree'} scale={2.7 + index % 3 * .4} />
        <Model models={models} asset="mini-forest/plant" position={[-side * 2, 0, 3]} scale={3} />
        {index % 3 === 0 && <Model models={models} asset="mini-forest/rocks-low" position={[side * 3, 0, 3]} scale={2.4} />}
        {area.kind === 'woodland' && index % 4 === 0 && <Model models={models} asset="mini-forest/tent" position={[side * 4, 0, 0]} scale={3} />}
        {area.kind === 'woodland' && index % 4 === 2 && <group position={[side * 6, 0, -3]} scale={3}>
          <Model models={models} asset="mini-forest/building-platform" />
          <Model models={models} asset="mini-forest/building-structure" position={[0, .5, 0]} />
          <Model models={models} asset="mini-forest/building-roof" position={[0, 1.5, 0]} />
        </group>}
      </>}
  </group>
}

function BridgeTile({ game, models, absolute }: { game: RouteGame; models: Models; absolute: number }) {
  const root = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!root.current) return
    const point = routePoint(game.current.distance, game.current.distance - absolute)
    root.current.position.set(point.x, point.y, point.z)
    const pitch = Math.atan((routeElevation(absolute + .1) - routeElevation(absolute - .1)) / .2)
    root.current.rotation.set(pitch, point.heading, 0, 'YXZ')
  })
  return <group ref={root} name={`bridge-deck-${absolute}`}>
    <Model models={models} asset="town/planks" position={[0, -.185, 0]} scale={[6, 1, 8]} rotation={[0, Math.PI / 2, 0]} />
    {[-1, 1].map(side => <group key={side} position={[side * 4.25, 0, 0]}>
      {[-1.5, 1.5].map(offset => <Model key={offset} models={models} asset="mini-forest/fence" position={[0, -.13, offset]} scale={2.7} rotation={[0, Math.PI / 2, 0]} />)}
      <Model models={models} asset="town/pillar-wood" position={[0, -.75, 0]} scale={[2, .65, 2]} />
    </group>)}
  </group>
}

function PondBridge({ game, models, absolute }: { game: RouteGame; models: Models; absolute: number }) {
  const root = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!root.current) return
    const point = routePoint(game.current.distance, game.current.distance - absolute, 20)
    root.current.position.set(point.x, -.10, point.z)
    root.current.rotation.y = point.heading
  })
  return <group ref={root} name={`pond-footbridge-${absolute}`}>
    <Model models={models} asset="mini-forest/bridge" scale={[25, 2.5, 7]} />
  </group>
}

function WaterBird({ game, absolute, index }: { game: RouteGame; absolute: number; index: number }) {
  const root = useRef<THREE.Group>(null)
  const swan = index === 2
  useFrame(({ clock }) => {
    if (!root.current) return
    const time = clock.elapsedTime
    const location = absolute + Math.cos(time * .23 + index * 2) * 1.4
    const span = waterSpan(location)
    const z = game.current.distance - location
    root.current.visible = !!span && span[0] > 0 && span[1] - span[0] > 4 && z < 8 && z > -100
    if (!span) return
    const lateral = span[0] + Math.min((span[1] - span[0]) / 2, 3 + index * 1.8) + Math.sin(time * .2 + index) * .8
    const point = routePoint(game.current.distance, z, lateral)
    root.current.position.set(point.x, -.16 + Math.sin(time * 1.6 + index) * .008, point.z)
    root.current.rotation.y = point.heading + Math.atan2(-Math.sin(time * .23 + index * 2) * .322, Math.cos(time * .2 + index) * .16)
  })
  return <group ref={root} name={`water-${swan ? 'swan' : 'duck'}-${absolute}-${index}`} visible={false} scale={swan ? 1.15 : .9}>
    <Part position={[0, .10, 0]} scale={swan ? [.4, .23, .25] : [.3, .18, .19]} color={swan ? '#fff5df' : index ? '#aa8154' : '#966f46'} />
    {swan && [[.2, .3], [.19, .49], [.16, .68], [.20, .87]].map(([x, y], i) => <Part key={i} position={[x, y, 0]} scale={[.085, .15, .085]} color="#fff5df" />)}
    <group position={[swan ? .3 : .22, swan ? .98 : .32, 0]}>
      <Part position={[0, 0, 0]} scale={[.13, .12, .11]} color={swan ? '#fff5df' : index ? '#aa8154' : '#37724f'} />
      <Part position={[.15, -.015, 0]} scale={[.10, .025, .055]} color="#e5a440" shape="box" />
      {[-1, 1].map(side => <Part key={side} position={[.05, .03, side * .1]} scale={[.017, .022, .012]} color="#17242b" />)}
    </group>
    {[-1, 1].map(side => <Part key={side} position={[-.06, .19, side * (swan ? .2 : .15)]} scale={[swan ? .28 : .19, .09, .075]} color={swan ? '#e5e8df' : '#bc9e74'} />)}
  </group>
}

export function RouteScenery({ game, timeOfDay }: { game: RouteGame; timeOfDay: TimeOfDay }) {
  const sources = useLoader(GLTFLoader, ROUTE_ASSETS.map(asset => `${import.meta.env.BASE_URL}assets/kenney/${asset}.glb`))
  const models = useMemo(() => new Map(ROUTE_ASSETS.map((asset, i) => [asset, sources[i]] as const)), [sources])
  const firstRow = Math.floor(game.current.distance / 24) - 2
  const rows = Array.from({ length: 10 }, (_, i) => Math.max(0, firstRow + i)).filter((row, i, all) => all.indexOf(row) === i)
  const nearbyAreas = [...new Map(rows.map(row => { const area = routeArea(row * 24); return [area.id, area] })).values()]
  const bridges = nearbyAreas.filter(area => area.kind === 'bridge').flatMap(area =>
    Array.from({ length: (area.end - area.start) / 6 }, (_, i) => area.start + 3 + i * 6)
      .filter(absolute => absolute > game.current.distance - 30 && absolute < game.current.distance + 162))
  const pondAreas = nearbyAreas.filter(area => area.kind === 'park')
  const waterRows = Array.from({ length: 4 }, (_, i) => (Math.floor(game.current.distance / 30) + i) * 30 + 12)
  const daylight = timeOfDay === 'daylight'
  return <group name="route-scenery">
    <RouteStrip game={game} span={[-4, 4]} daylight={daylight} />
    {[-4, -1.25, 1.25, 4].map(edge => <RouteStrip key={edge} game={game} span={[edge - .025, edge + .025]} type="line" daylight={daylight} />)}
    <RouteStrip game={game} span={[-35, -4.2]} type="ground" daylight={daylight} />
    <RouteStrip game={game} span={[4.2, 80]} type="ground" daylight={daylight} />
    <RouteStrip game={game} span={[0, 0]} type="water" daylight={daylight} />
    {rows.flatMap(row => [-1, 1].map(side => <Decoration key={`${row}-${side}`} game={game} models={models} absolute={row * 24} side={side} />))}
    {bridges.map(absolute => <BridgeTile key={absolute} game={game} models={models} absolute={absolute} />)}
    {pondAreas.map(area => <PondBridge key={area.id} game={game} models={models} absolute={area.start + 140} />)}
    {waterRows.flatMap(absolute => [0, 1, 2].map(index => <WaterBird key={`${absolute}-${index}`} game={game} absolute={absolute} index={index} />))}
  </group>
}
