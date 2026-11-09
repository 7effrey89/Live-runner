import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { inJumpZone, jumpZone } from './jumpGuidance'
import { laneX } from './gameLogic'
import type { Game, Item } from './gameLogic'
import { routePoint } from './route'

const SEGMENTS = 24

function ribbonGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 6), 3))
  const uv = []
  const indices = []
  for (let i = 0; i <= SEGMENTS; i++) uv.push(0, i / SEGMENTS, 1, i / SEGMENTS)
  for (let i = 0; i < SEGMENTS; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}

function GuideRibbon({ game, item, id, offset, count }: { game: RefObject<Game>; item?: Item; id: number; offset: number; count: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.ShaderMaterial>(null)
  const geometry = useMemo(() => ribbonGeometry(), [])
  const uniforms = useMemo(() => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tint: { value: new THREE.Color(item ? '#d7f293' : '#65e1dc') },
    zone: { value: item ? 1 : 0 }, spanLength: { value: 1 }, glow: { value: 0 },
  }]), [item])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    if (!mesh.current || !material.current) return
    const g = game.current
    const zone = item ? jumpZone(item, g.speed, g.difficulty) : undefined
    mesh.current.visible = g.phase === 'running' && g.recovery === 0 && (!item || !!zone)
    if (!mesh.current.visible) return
    const near = zone ? zone.near : 5
    const far = zone ? zone.far : -100
    const center = laneX(item ? item.lane : g.lane) + offset
    const position = geometry.getAttribute('position')
    for (let i = 0; i <= SEGMENTS; i++) {
      const z = near + (far - near) * i / SEGMENTS
      for (let side = 0; side < 2; side++) {
        const point = routePoint(g.distance, z, center + (side ? 1 : -1) * 1.03 / count)
        position.setXYZ(i * 2 + side, point.x, point.y - (item ? .075 : .09), point.z)
      }
    }
    position.needsUpdate = true
    geometry.computeBoundingSphere()
    material.current.uniforms.spanLength.value = Math.abs(far - near)
    material.current.uniforms.glow.value = zone && inJumpZone(zone) && g.jump === 0 && g.slide === 0 && item?.lane === g.lane ? 1 : 0
  })
  return <mesh ref={mesh} name={item ? `jump-zone-${item.id}-p${id}` : `assisted-lane-${id}`} geometry={geometry} renderOrder={item ? 3 : 2} visible={false}>
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} fog
      vertexShader={`varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
        }`}
      fragmentShader={`varying vec2 vUv;uniform vec3 tint;uniform float zone;uniform float spanLength;uniform float glow;
        #include <fog_pars_fragment>
        void main(){float edge=step(.45,abs(vUv.x-.5));
        float arrow=1.-smoothstep(.025,.065,abs(fract(vUv.y*spanLength/2.5)-.5+mix(1.,-1.,zone)*abs(vUv.x-.5)*.65));
        float alpha=mix(.04,.22,zone)+edge*.3+arrow*.18+glow*.12;
        gl_FragColor=vec4(tint,alpha);
        #include <fog_fragment>
        #include <colorspace_fragment>
        }`} />
  </mesh>
}

export function AssistedGuidance({ game, items, id, offset, count }: { game: RefObject<Game>; items: readonly Item[]; id: number; offset: number; count: number }) {
  return <group name={`assisted-guidance-${id}`}>
    <GuideRibbon game={game} id={id} offset={offset} count={count} />
    {items.filter(item => (item.kind === 'barrier' || item.kind === 'mystery') && !item.hit && !item.fall).map(item => <GuideRibbon key={item.id} game={game} item={item} id={id} offset={offset} count={count} />)}
  </group>
}
