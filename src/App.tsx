import { Canvas, useFrame } from '@react-three/fiber'
import { PoseLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import './App.css'

type Lane = -1 | 0 | 1
type Phase = 'ready' | 'running' | 'over'
type Kind = 'barrier' | 'overhead' | 'block' | 'coin'
type Item = { id: number; lane: Lane; z: number; kind: Kind; hit: boolean }
type Game = {
  phase: Phase; lane: Lane; jump: number; slide: number; distance: number
  coins: number; speed: number; items: Item[]; nextSpawn: number; nextId: number
}

const laneX = (lane: Lane) => lane * 2.5
const newGame = (): Game => ({
  phase: 'ready', lane: 0, jump: 0, slide: 0, distance: 0,
  coins: 0, speed: 15, items: [], nextSpawn: 35, nextId: 0,
})
const scoreOf = (game: Game) => Math.floor(game.distance) + game.coins * 50

function Runner({ game }: { game: MutableRefObject<Game> }) {
  const runner = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (!runner.current) return
    const g = game.current
    runner.current.position.x = THREE.MathUtils.damp(runner.current.position.x, laneX(g.lane), 12, delta)
    runner.current.position.y = g.jump > 0 ? Math.sin((1 - g.jump / 0.9) * Math.PI) * 2.1 : 0
    runner.current.scale.y = g.slide > 0 ? 0.48 : 1
    runner.current.rotation.z = (laneX(g.lane) - runner.current.position.x) * -0.07
  })
  return (
    <group ref={runner}>
      <mesh position={[0, 0.7, 0]} castShadow><capsuleGeometry args={[0.38, 0.65, 4, 8]} /><meshStandardMaterial color="#d5ff51" /></mesh>
      <mesh position={[0, 1.65, 0]} castShadow><sphereGeometry args={[0.32, 16, 12]} /><meshStandardMaterial color="#f4c6a5" /></mesh>
      <mesh position={[0, 1.73, 0.16]}><boxGeometry args={[0.48, 0.16, 0.28]} /><meshStandardMaterial color="#17234b" /></mesh>
      {[-1, 1].map(side => <group key={side}>
        <mesh position={[side * 0.53, 0.9, 0]} rotation={[0, 0, side * -0.25]} castShadow><capsuleGeometry args={[0.13, 0.55, 4, 8]} /><meshStandardMaterial color="#d5ff51" /></mesh>
        <mesh position={[side * 0.23, 0.18, 0]} castShadow><boxGeometry args={[0.26, 0.38, 0.48]} /><meshStandardMaterial color="#f9f5e9" /></mesh>
      </group>)}
    </group>
  )
}

function Obstacle({ item }: { item: Item }) {
  const x = laneX(item.lane)
  if (item.kind === 'coin') return <group position={[x, 1.1, item.z]} rotation={[0, 0, 0.25]}>
    <mesh><torusGeometry args={[0.38, 0.11, 8, 24]} /><meshStandardMaterial color="#ffdb61" emissive="#d77b1a" emissiveIntensity={0.5} /></mesh>
    <mesh><sphereGeometry args={[0.12, 12, 8]} /><meshBasicMaterial color="#fff4b1" /></mesh>
  </group>
  if (item.kind === 'overhead') return <group position={[x, 0, item.z]}>
    {[-0.9, 0.9].map(side => <mesh key={side} position={[side, 1.25, 0]} castShadow><boxGeometry args={[0.18, 2.5, 0.35]} /><meshStandardMaterial color="#824fa5" /></mesh>)}
    <mesh position={[0, 2.15, 0]} castShadow><boxGeometry args={[2, 0.65, 0.55]} /><meshStandardMaterial color="#ec79ba" /></mesh>
    <mesh position={[0, 2.15, 0.29]}><boxGeometry args={[1.5, 0.08, 0.02]} /><meshBasicMaterial color="#ffe7aa" /></mesh>
  </group>
  return <group position={[x, 0, item.z]}>
    <mesh position={[0, item.kind === 'block' ? 1.25 : 0.45, 0]} castShadow>
      <boxGeometry args={[1.9, item.kind === 'block' ? 2.5 : 0.9, 0.8]} />
      <meshStandardMaterial color={item.kind === 'block' ? '#6d6cdb' : '#ff986f'} />
    </mesh>
    <mesh position={[0, item.kind === 'block' ? 1.25 : 0.45, 0.41]}><boxGeometry args={[1.45, 0.1, 0.02]} /><meshBasicMaterial color="#fff2b0" /></mesh>
  </group>
}

function World({ game, snapshot, onTick }: {
  game: MutableRefObject<Game>; snapshot: Game; onTick: () => void
}) {
  const elapsed = useRef(0)
  useFrame((_, delta) => {
    const g = game.current
    if (g.phase !== 'running') return
    const dt = Math.min(delta, 0.05)
    g.speed = Math.min(31, 15 + g.distance / 180)
    const travel = g.speed * dt
    g.distance += travel
    g.jump = Math.max(0, g.jump - dt)
    g.slide = Math.max(0, g.slide - dt)
    g.nextSpawn -= travel
    if (g.nextSpawn <= 0) {
      const lane = (Math.floor(Math.random() * 3) - 1) as Lane
      const kinds: Kind[] = ['barrier', 'overhead', 'block']
      g.items.push({ id: g.nextId++, lane, z: -85, kind: kinds[Math.floor(Math.random() * kinds.length)], hit: false })
      const coinLane = (lane === 1 ? -1 : lane + 1) as Lane
      for (let i = 0; i < 3; i++) g.items.push({ id: g.nextId++, lane: coinLane, z: -85 - i * 3, kind: 'coin', hit: false })
      g.nextSpawn = 20 + Math.random() * 8
    }
    for (const item of g.items) {
      item.z += travel
      if (!item.hit && Math.abs(item.z) < 0.9 && item.lane === g.lane) {
        item.hit = true
        if (item.kind === 'coin') g.coins++
        else if (!(item.kind === 'barrier' && g.jump > 0.15 && g.jump < 0.75) && !(item.kind === 'overhead' && g.slide > 0)) g.phase = 'over'
      }
    }
    g.items = g.items.filter(item => item.z < 8 && !(item.hit && item.kind === 'coin'))
    elapsed.current += dt
    if (elapsed.current > 0.07 || g.phase === 'over') {
      elapsed.current = 0
      onTick()
    }
  })
  return <>
    <color attach="background" args={['#f5b5a0']} />
    <fog attach="fog" args={['#f5b5a0', 35, 100]} />
    <ambientLight intensity={1.4} />
    <directionalLight position={[5, 12, 4]} intensity={2} castShadow />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.13, -35]} receiveShadow><planeGeometry args={[8, 160]} /><meshStandardMaterial color="#353c68" /></mesh>
    {[-4, 4].map(x => <mesh key={x} position={[x, 0, -35]}><boxGeometry args={[0.18, 0.18, 160]} /><meshStandardMaterial color="#f7ad92" /></mesh>)}
    {[-1.25, 1.25].map(x => <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.005, -35]}><planeGeometry args={[0.035, 160]} /><meshBasicMaterial color="#8f92a9" /></mesh>)}
    {Array.from({ length: 14 }, (_, i) => {
      const z = -((i * 10 + snapshot.distance % 10) % 140)
      return <group key={i}>
        {[-1, 1].map(side => <group key={side} position={[side * 7, 0, z]}>
          <mesh position={[0, 0.45, 0]}><boxGeometry args={[1.7, 0.9, 1.7]} /><meshStandardMaterial color="#da8e88" /></mesh>
          <mesh position={[0, 1.35, 0]}><coneGeometry args={[0.9, 2.2, 4]} /><meshStandardMaterial color={i % 2 ? '#f5cb9a' : '#c8758c'} /></mesh>
        </group>)}
      </group>
    })}
    {snapshot.items.map(item => <Obstacle key={item.id} item={item} />)}
    <Runner game={game} />
  </>
}

function App() {
  const game = useRef<Game>(newGame())
  const [snapshot, setSnapshot] = useState<Game>(newGame)
  const [cameraStatus, setCameraStatus] = useState('Camera off')
  const [cameraOn, setCameraOn] = useState(false)
  const [calibration, setCalibration] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const refresh = useCallback(() => setSnapshot({ ...game.current, items: [...game.current.items] }), [])
  const act = useCallback((action: 'left' | 'right' | 'jump' | 'slide') => {
    const g = game.current
    if (g.phase !== 'running') return
    if (action === 'left') g.lane = Math.max(-1, g.lane - 1) as Lane
    if (action === 'right') g.lane = Math.min(1, g.lane + 1) as Lane
    if (action === 'jump' && g.jump === 0 && g.slide === 0) g.jump = 0.9
    if (action === 'slide' && g.jump === 0) g.slide = 0.8
    refresh()
  }, [refresh])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const actions: Record<string, 'left' | 'right' | 'jump' | 'slide'> = {
        ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right',
        ArrowUp: 'jump', w: 'jump', ' ': 'jump', ArrowDown: 'slide', s: 'slide',
      }
      const action = actions[event.key]
      if (action && game.current.phase === 'running') {
        event.preventDefault()
        if (!event.repeat || action === 'slide') act(action)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [act])

  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false
    let stream: MediaStream | undefined
    let detector: PoseLandmarker | undefined
    let frame = 0
    let lastVideoTime = -1
    let baseline: { x: number; y: number } | undefined
    let jumpReady = true
    let lastDetection = 0
    const video = videoRef.current
    const start = async () => {
      try {
        setCameraStatus('Starting camera…')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return }
        if (!video) { stream.getTracks().forEach(track => track.stop()); return }
        video.srcObject = stream
        await video.play()
        if (cancelled) return
        setCameraStatus('Loading body tracking…')
        detector = await PoseLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
          runningMode: 'VIDEO', numPoses: 1,
        })
        if (cancelled) { detector.close(); return }
        const detect = (time: number) => {
          if (cancelled || !detector) return
          if (video.readyState >= 2 && video.currentTime !== lastVideoTime && time - lastDetection > 50) {
            lastVideoTime = video.currentTime
            lastDetection = time
            const pose = detector.detectForVideo(video, time).landmarks[0]
            const shoulders = pose && [pose[11], pose[12]]
            const hips = pose && [pose[23], pose[24]]
            const ankles = pose && [pose[27], pose[28]]
            if (shoulders && hips && ankles && [...shoulders, ...hips, ...ankles].every(point => (point.visibility ?? 0) > 0.5)) {
              const x = (hips[0].x + hips[1].x) / 2
              const y = (hips[0].y + hips[1].y) / 2
              if (!baseline) baseline = { x, y }
              setCameraStatus('Body tracking active')
              if (game.current.phase === 'running') {
                const shift = baseline.x - x
                game.current.lane = shift < -0.09 ? -1 : shift > 0.09 ? 1 : 0
                const height = baseline.y - y
                if (height > 0.07 && jumpReady) { act('jump'); jumpReady = false }
                if (height < 0.025) jumpReady = true
                if (height < -0.09) act('slide')
              }
            } else setCameraStatus('Step back so your full body is visible')
          }
          frame = requestAnimationFrame(detect)
        }
        frame = requestAnimationFrame(detect)
      } catch {
        stream?.getTracks().forEach(track => track.stop())
        detector?.close()
        if (video) video.srcObject = null
        if (!cancelled) setCameraStatus('Camera or tracking unavailable. Try keyboard controls.')
      }
    }
    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      detector?.close()
      stream?.getTracks().forEach(track => track.stop())
      if (video) video.srcObject = null
    }
  }, [cameraOn, calibration, act])

  const startRun = () => {
    game.current = { ...newGame(), phase: 'running' }
    refresh()
  }
  return <main className="app">
    <header className="topbar">
      <a className="brand" href="#" aria-label="Stride Sky home"><span className="brand-mark">S<span>✦</span></span><span>STRIDE <b>SKY</b><small>THE MOTION ARCADE</small></span></a>
      <div className="top-right"><span className="live-dot" /> YOUR SPACE TO MOVE <span className="top-divider" /> <span>01 / ENDLESS RUN</span></div>
    </header>
    <div className="page-heading"><div><div className="eyebrow"><span /> THE MOTION ARCADE &nbsp; / &nbsp; GAME 01</div><h1>Find your stride<span>.</span></h1><p>A little movement. A lot of momentum.</p></div><div className="heading-note">MADE FOR MOVING <span>↗</span></div></div>
    <div className="layout">
      <section className="game-card" aria-label="Game">
        <div className="game-top"><div><span className="game-label">✦ &nbsp; STRIDE SKY</span><span className="game-sub"> / &nbsp; ENDLESS RUN</span></div><div className="game-status"><span /> {snapshot.phase === 'running' ? 'RUN IN PROGRESS' : 'READY WHEN YOU ARE'}</div></div>
        <div className="game-view">
          <Canvas shadows camera={{ position: [0, 5.2, 9], fov: 50 }} onCreated={({ camera }) => camera.lookAt(0, 0.8, -15)}>
            <World game={game} snapshot={snapshot} onTick={refresh} />
          </Canvas>
          <div className="scoreboard"><div><small>SCORE</small><strong>{String(scoreOf(snapshot)).padStart(5, '0')}</strong></div><div><small>DISTANCE</small><strong>{Math.floor(snapshot.distance)}<em> m</em></strong></div><div><small>STARS</small><strong><em>✦ </em>{snapshot.coins}</strong></div></div>
          {snapshot.phase !== 'running' && <div className="game-overlay"><div className="overlay-content"><div className="overlay-icon">✦</div><div className="overlay-kicker">{snapshot.phase === 'over' ? 'NICE MOVES!' : 'YOUR RUN STARTS HERE'}</div><h2>{snapshot.phase === 'over' ? 'What a run.' : 'Ready, set, move.'}</h2><p>{snapshot.phase === 'over' ? `You scored ${scoreOf(snapshot)} points. Ready to go again?` : 'Dodge, duck and jump your way to a new high score.'}</p><button className="primary-button" onClick={startRun}>{snapshot.phase === 'over' ? 'PLAY AGAIN' : 'START RUN'} <span>↗</span></button><div className="overlay-foot">NO CAMERA? NO PROBLEM. USE YOUR KEYBOARD.</div></div></div>}
          <div className="view-bottom"><span>✦ &nbsp; KEEP MOVING FORWARD</span><span>THE SKY IS YOURS &nbsp; ↗</span></div>
        </div>
        <div className="game-footer"><span><span className="footer-dot" /> {snapshot.phase === 'running' ? 'YOU’RE ON A ROLL' : 'WAITING FOR PLAYER'}</span><span>BUILT TO MOVE &nbsp; ✦</span></div>
      </section>
      <aside className="sidebar">
        <div className="panel camera-panel"><div className="panel-heading"><div><span className="section-number">01 / YOUR CAMERA</span><h2>Get in frame<span>.</span></h2></div><span className="panel-icon">⌗</span></div>
          <div className="camera-preview"><video ref={videoRef} autoPlay muted playsInline /><div className="camera-placeholder">{!cameraOn && <><span className="camera-symbol">◎</span><strong>YOUR SPACE TO MOVE</strong><small>Camera preview appears here</small></>}</div><span className="preview-corner tl" /><span className="preview-corner tr" /><span className="preview-corner bl" /><span className="preview-corner br" /><div className="preview-label"><span /> {cameraOn ? 'CAMERA ON' : 'CAMERA OFF'}</div></div>
          <p className="camera-hint">{cameraOn ? cameraStatus : 'Enable your camera and make sure your whole body is in view.'}</p>
          <button className="camera-button" onClick={() => { setCameraOn(!cameraOn); if (cameraOn) setCameraStatus('Camera off') }}>{cameraOn ? 'TURN CAMERA OFF' : 'ENABLE CAMERA'} <span>↗</span></button>
          {cameraOn && <button className="text-button" onClick={() => setCalibration(value => value + 1)}>Recalibrate standing position ↻</button>}
          <div className="privacy">✳ &nbsp; Your camera stays on your device.</div>
        </div>
        <div className="panel controls-panel"><div className="panel-heading"><div><span className="section-number">02 / HOW TO PLAY</span><h2>Make your move<span>.</span></h2></div><span className="panel-icon">↗</span></div>
          <div className="control-row"><span className="control-icon">↔</span><div><strong>Move left or right</strong><small>Shift your body to switch lanes</small></div><kbd>← →</kbd></div>
          <div className="control-row"><span className="control-icon">↑</span><div><strong>Jump over</strong><small>Jump to clear low obstacles</small></div><kbd>↑</kbd></div>
          <div className="control-row"><span className="control-icon">↓</span><div><strong>Duck under</strong><small>Squat to slide under barriers</small></div><kbd>↓</kbd></div>
          <div className="tip"><span>✦</span><p><strong>A little tip</strong>Collect stars for bonus points. The longer you run, the faster it gets!</p></div>
        </div>
      </aside>
    </div>
    <footer className="page-footer"><span>✦ &nbsp; STRIDE SKY</span><span>AN ORIGINAL MOTION ARCADE EXPERIENCE</span><span>MOVE AT YOUR OWN PACE &nbsp; ↗</span></footer>
  </main>
}

export default App
