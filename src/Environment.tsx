import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { sceneryZ } from './scenery'
import type { TimeOfDay } from './scenery'
import { ForestWildlife } from './ForestWildlife'
import type { Game } from './gameLogic'
import { RouteScenery } from './RouteScenery'
import { routeArea, routePoint } from './route'

const files = ['tree.png', 'treePine.png', 'treeLong.png', 'treeOrange.png', 'bush1.png', 'cloud1.png', 'cloud3.png', 'moonFull.png', 'castleSmall.png']
const root = `${import.meta.env.BASE_URL}assets/kenney/environment/`

export function Environment({ game, timeOfDay }: { game: RefObject<Pick<Game, 'distance' | 'phase' | 'speed'>>; timeOfDay: TimeOfDay }) {
  const daylight = timeOfDay === 'daylight'
  const sources = useLoader(THREE.TextureLoader, files.map(file => root + file))
  const textures = useMemo(() => sources.map(source => {
    const texture = source.clone()
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }), [sources])
  const trees = useRef<(THREE.Group | null)[]>([])
  const clouds = useRef<(THREE.Sprite | null)[]>([])
  const moon = useRef<THREE.Sprite>(null)
  const fireflies = useRef<THREE.Points>(null)
  const fireflyGeometry = useMemo(() => {
    const positions = []
    for (let i = 0; i < 72; i++) positions.push((i % 2 ? -1 : 1) * (5 + i * 37 % 14), 1 + i % 7 * 0.45, sceneryZ(i % 18, 0))
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  }, [])
  const sky = useMemo(() => ({
    top: { value: new THREE.Color(daylight ? '#5fa9eb' : '#081426') },
    horizon: { value: new THREE.Color(daylight ? '#dcefc0' : '#3b315e') },
  }), [daylight])
  useEffect(() => () => {
    textures.forEach(texture => texture.dispose())
    fireflyGeometry.dispose()
  }, [textures, fireflyGeometry])
  useFrame(({ clock }) => {
    const time = clock.elapsedTime
    const distance = game.current.distance
    trees.current.forEach((tree, i) => {
      if (!tree) return
      const z = sceneryZ(Math.floor(i / 2), distance)
      const area = routeArea(distance - z)
      const point = routePoint(distance, z, (i % 2 ? -1 : 1) * (14 + i % 3 * 4))
      tree.visible = z < -75 && (area.kind === 'forest' || area.kind === 'woodland')
      tree.position.set(point.x, 0, point.z)
      tree.rotation.z = Math.sin(time * 1.2 + i) * 0.012
    })
    clouds.current.forEach((cloud, i) => {
      if (!cloud) return
      cloud.position.x = -40 + i * 35 + Math.sin(time * 0.035 + i * 2) * 12
      cloud.position.y = 22 + i * 4 + Math.cos(time * 0.08 + i) * 0.5
    })
    if (moon.current) moon.current.position.y = 27 + Math.sin(time * 0.08) * 0.3
    if (fireflies.current) {
      const position = fireflies.current.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) {
        const point = routePoint(distance, sceneryZ(i % 18, distance) + Math.sin(i * 17) * 3, (i % 2 ? -1 : 1) * (5 + i * 37 % 14))
        position.setX(i, point.x)
        position.setZ(i, point.z)
        position.setY(i, 1 + i % 7 * 0.45 + Math.sin(time * 1.4 + i) * 0.25)
      }
      position.needsUpdate = true
    }
  })
  const aspect = (index: number) => {
    const image = textures[index].image
    if (!(image instanceof HTMLImageElement)) throw new Error('Environment texture did not load as an image')
    return image.width / image.height
  }
  return <>
    <ForestWildlife game={game} />
    <RouteScenery game={game} timeOfDay={timeOfDay} />
    <color attach="background" args={[daylight ? '#b9dcdf' : '#202443']} />
    <fog attach="fog" args={[daylight ? '#b9dcdf' : '#202443', 35, 130]} />
    <ambientLight intensity={daylight ? 1.8 : 1.2} color={daylight ? '#fff3d1' : '#c0d9ed'} />
    <directionalLight position={[-8, 14, 6]} intensity={daylight ? 2.4 : 2.2} color={daylight ? '#fff5e5' : '#cbdcff'} castShadow shadow-normalBias={.03} shadow-bias={-.0001} />
    <mesh position={[0, 40, -180]}>
      <planeGeometry args={[400, 180]} />
      <shaderMaterial uniforms={sky} toneMapped={false}
        vertexShader="varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
        fragmentShader={`uniform vec3 top; uniform vec3 horizon; varying vec2 vUv;
          void main(){gl_FragColor=vec4(mix(horizon,top,smoothstep(0.1,0.85,vUv.y)),1.0);
          #include <colorspace_fragment>
          }`} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, -90]} receiveShadow>
      <planeGeometry args={[400, 400]} /><meshStandardMaterial color={daylight ? '#68994a' : '#162d2c'} />
    </mesh>
    <sprite ref={moon} visible={!daylight} position={[-26, 27, -130]} scale={[14, 14, 1]}>
      <spriteMaterial map={textures[7]} transparent fog={false} />
    </sprite>
    <mesh name="daylight-sun" visible={daylight} position={[-26, 27, -130]}>
      <sphereGeometry args={[7, 24, 16]} /><meshBasicMaterial color="#fff7bd" fog={false} toneMapped={false} />
    </mesh>
    {[0, 1, 2].map(i => <sprite key={i} ref={object => { clouds.current[i] = object }} position={[-40 + i * 35, 22 + i * 4, -125]} scale={[12 * aspect(5 + i % 2), 12, 1]}>
      <spriteMaterial map={textures[5 + i % 2]} color={daylight ? '#ffffff' : '#777aaf'} opacity={daylight ? 0.82 : 0.45} transparent depthWrite={false} fog={false} />
    </sprite>)}
    <sprite position={[28, 5, -110]} scale={[10 * aspect(8), 10, 1]}>
      <spriteMaterial map={textures[8]} color={daylight ? '#95aca0' : '#6f7c99'} transparent alphaTest={0.2} />
    </sprite>
    {Array.from({ length: 36 }, (_, i) => {
      const side = i % 2 ? -1 : 1
      const height = 5.5 + i % 4 * 1.1
      return <group key={i} ref={object => { trees.current[i] = object }} position={[side * (7.5 + i % 3 * 2), 0, sceneryZ(Math.floor(i / 2), 0)]}>
        <sprite position={[0, height / 2, 0]} scale={[height * aspect(i % 4), height, 1]}>
          <spriteMaterial map={textures[i % 4]} color={daylight ? '#d5edbd' : '#92b2aa'} transparent alphaTest={0.2} />
        </sprite>
        {i % 3 === 0 && <>
          <sprite position={[-side * 1.8, 0.75, 2]} scale={[1.5 * aspect(4), 1.5, 1]}>
            <spriteMaterial map={textures[4]} color={daylight ? '#d5edbd' : '#76a994'} transparent alphaTest={0.2} />
          </sprite>
          <mesh visible={!daylight} position={[-side * 2, 0.35, 0]}><sphereGeometry args={[0.12, 8, 6]} /><meshBasicMaterial color="#a6efda" toneMapped={false} /></mesh>
        </>}
      </group>
    })}
    <points ref={fireflies} visible={!daylight} geometry={fireflyGeometry} frustumCulled={false}>
      <pointsMaterial color="#caf298" size={0.1} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
    </points>
  </>
}
