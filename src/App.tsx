import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { PoseLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createBodyTracker, isVisiblePoint } from './bodyTracking'
import type { BodyPoint } from './bodyTracking'
import { createDualDwellController, getHandPointers } from './handPointer'
import type { Hand } from './handPointer'
import { createCrossedArmsCalibrator } from './crossedArms'
import { CHARACTERS, cycleCharacter } from './characters'
import type { CharacterId } from './characters'
import { SceneBoundary } from './SceneBoundary'
import { Environment } from './Environment'
import { AudioSettings } from './AudioSettings'
import { useGameAudio } from './useGameAudio'
import type { SoundEffect } from './gameAudio'
import { JUMP_DURATION, JUMP_START_FRACTION, JUMP_BLEND, jumpHeight } from './runnerMotion'
import { fallOpacity, laneX, MAX_RUN_SPEED, MIN_RUN_SPEED, newGame, recoveryPose, requestJump, scoreOf } from './gameLogic'
import type { Game, Item, Lane, Mode } from './gameLogic'
import { createAvatarRig } from './avatarRig'
import type { AvatarFrame } from './avatarPose'
import type { TimeOfDay } from './scenery'
import { routeArea, routePoint } from './route'
import { DEFAULT_DIFFICULTY } from './difficulty'
import { DifficultyControl } from './DifficultyControl'
import { AssistedGuidance } from './AssistedGuidance'
import { jumpNow } from './jumpGuidance'
import { advanceMultiplayer, avatarScale, createPlayers, keyboardControl, MAX_PLAYERS, PLAYER_COLORS, playerOffset, setPlayerDifficulty, snapshotPlayers, stopPlayers } from './multiplayer'
import type { PlayerSnapshot, RunnerPlayer } from './multiplayer'
import { createPlayerRoster } from './playerTracking'
import { createFrameRateCounter } from './frameRate'
import './App.css'

const characterAssetRoot = `${import.meta.env.BASE_URL}assets/kenney/characters/`
type RunnerProjection = { x: number; y: number; width: number; feetOffset: number; labelX: number; labelY: number; visible: boolean }
type LobbySide = 'left' | 'right'
type CameraPlayerStatus = {
  id: number; ready: boolean; status: string; jumpRegistered: boolean; jumpTracking: 'shoulders' | 'hips'
  showFeedback: boolean
}
type CameraController = {
  body: ReturnType<typeof createBodyTracker>; cross: ReturnType<typeof createCrossedArmsCalibrator>
  sliding: boolean; enrolledAt: number
  jumpFeedback?: { game: Game; jumpId: number; until: number; queued: boolean }
}

function LoadingCharacter({ onLoadingChange }: { onLoadingChange: (loading: boolean) => void }) {
  useEffect(() => {
    onLoadingChange(true)
    return () => onLoadingChange(false)
  }, [onLoadingChange])
  return null
}

function Runner({ game, course, character, onLoadingChange, avatars, onProject, id, index, count, silhouette }: {
  game: MutableRefObject<Game>; character: CharacterId; onLoadingChange?: (loading: boolean) => void
  course: MutableRefObject<Game>; avatars: MutableRefObject<Record<number, AvatarFrame | undefined>>
  onProject: (id: number, projection: RunnerProjection) => void
  id: number; index: number; count: number
  silhouette?: LobbySide
}) {
  const [source, idle, run, jump] = useLoader(FBXLoader, [
    `${characterAssetRoot}Model/characterMedium.fbx`,
    `${characterAssetRoot}Animations/idle.fbx`,
    `${characterAssetRoot}Animations/run.fbx`,
    `${characterAssetRoot}Animations/jump.fbx`,
  ])
  const sourceTexture = useLoader(THREE.TextureLoader, `${characterAssetRoot}Skins/${character}.png`)
  const texture = useMemo(() => {
    const copy = sourceTexture.clone()
    copy.colorSpace = THREE.SRGBColorSpace
    copy.needsUpdate = true
    return copy
  }, [sourceTexture])
  const model = useMemo(() => {
    const copy = clone(source)
    copy.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone()
        object.castShadow = !silhouette
        object.receiveShadow = !silhouette
        object.frustumCulled = false
      }
    })
    return copy
  }, [source, silhouette])
  const rig = useMemo(() => createAvatarRig(model), [model])
  const sizing = useMemo(() => {
    const box = new THREE.Box3().setFromObject(source)
    const height = box.max.y - box.min.y
    if (!Number.isFinite(height) || height <= 0) throw new Error('Character model has invalid dimensions')
    const scale = 1.9 / height
    return { scale, offset: -box.min.y * scale }
  }, [source])
  const animation = useRef<{
    mixer: THREE.AnimationMixer
    actions: { idle: THREE.AnimationAction; run: THREE.AnimationAction; jump: THREE.AnimationAction }
    active: THREE.AnimationAction | undefined
  } | undefined>(undefined)
  useEffect(() => {
    model.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshStandardMaterial) {
            material.map = silhouette ? null : texture
            material.color.set(silhouette ? '#83dcff' : '#ffffff')
            if (silhouette) {
              material.transparent = true
              material.opacity = .32
              material.depthWrite = false
            }
            material.needsUpdate = true
          }
        }
      }
    })
    onLoadingChange?.(false)
  }, [model, texture, onLoadingChange, silhouette])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => {
    const mixer = new THREE.AnimationMixer(model)
    const action = (asset: THREE.Group, name: string) => {
      const clip = asset.animations.find(item => item.name.endsWith(`|${name}`))
      if (!clip) throw new Error(`Character animation missing: ${name}`)
      return mixer.clipAction(clip)
    }
    const jumpAction = action(jump, 'Jump')
    jumpAction.setLoop(THREE.LoopOnce, 1)
    jumpAction.clampWhenFinished = true
    animation.current = {
      mixer,
      actions: { idle: action(idle, 'Idle'), run: action(run, 'Run'), jump: jumpAction },
      active: undefined,
    }
    return () => {
      animation.current = undefined
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(material => material.dispose())
        }
      })
    }
  }, [model, idle, run, jump])
  const runner = useRef<THREE.Group>(null)
  const playedJump = useRef(-1)
  const runnerLateral = useRef(0)
  const projected = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }, delta) => {
    if (!runner.current) return
    const g = game.current
    const scale = avatarScale(count) * (silhouette ? .72 : 1)
    const facingViewer = course.current.phase !== 'running' && g.recovery === 0
    runner.current.visible = course.current.phase !== 'running' || g.phase !== 'over' || g.recovery > 0
    const reaction = recoveryPose(g.recovery, g.impact)
    runner.current.rotation.x = reaction.pitch
    runner.current.rotation.z = (facingViewer ? 0 : (laneX(g.lane) - runnerLateral.current) * -0.07) + reaction.roll
    const playback = animation.current
    if (!playback) return
    const { actions, mixer } = playback
    rig.restore()
    const next = silhouette || g.phase !== 'running' || g.slide > 0 || g.recovery > 0 ? actions.idle : g.jump > 0 ? actions.jump : actions.run
    if (next !== playback.active || (next === actions.jump && playedJump.current !== g.jumpId)) {
      next.reset()
      if (next === actions.jump) {
        playedJump.current = g.jumpId
        next.time = next.getClip().duration * JUMP_START_FRACTION
      }
      next.play()
      if (playback.active !== next) playback.active?.crossFadeTo(next, JUMP_BLEND, false)
      playback.active = next
    }
    actions.run.setEffectiveTimeScale(g.speed / 15)
    actions.jump.setEffectiveTimeScale(actions.jump.getClip().duration * (1 - JUMP_START_FRACTION) / JUMP_DURATION)
    mixer.update(delta)
    const body = rig.apply(silhouette || g.recovery > 0.3 ? undefined : avatars.current[id], facingViewer,
      g.phase === 'running' && g.slide > 0 && g.recovery === 0, delta,
      !facingViewer && g.recovery > 0 && g.impact === 'fall', scale)
    runnerLateral.current = THREE.MathUtils.damp(runnerLateral.current, facingViewer ? body.shift * scale : laneX(g.lane), 24, delta)
    const offset = silhouette ? (silhouette === 'left' ? -1 : 1) * Math.min(1.5, size.width / size.height * 1.65) : playerOffset(index, count)
    const point = routePoint(course.current.distance, 0, runnerLateral.current + offset)
    runner.current.position.set(point.x, point.y + (facingViewer ? 0 : jumpHeight(g.jump) * scale) + body.lower + (facingViewer ? body.lift * scale : 0), point.z)
    runner.current.rotation.y = point.heading + (facingViewer ? 0 : Math.PI)
    if (g.recovery > 0) runner.current.position.y = Math.max(point.y + .04 * scale, runner.current.position.y) + reaction.lift * scale
    {
      const { x, y, z } = runner.current.position
      projected.set(x, y + 1.95 * scale, z).project(camera)
      const labelX = (projected.x * .5 + .5) * size.width
      const labelY = (-projected.y * .5 + .5) * size.height
      projected.set(x, y + 0.8 * scale, z).project(camera)
      const centerX = (projected.x * 0.5 + 0.5) * size.width
      const centerY = (-projected.y * 0.5 + 0.5) * size.height
      projected.set(x + .9 * scale * Math.cos(point.heading), y + .8 * scale, z - .9 * scale * Math.sin(point.heading)).project(camera)
      const radius = Math.max(65, Math.abs((projected.x * 0.5 + 0.5) * size.width - centerX))
      projected.set(x, y, z).project(camera)
      onProject(id, {
        x: centerX, y: centerY, width: radius * 2 + 46,
        feetOffset: (-projected.y * 0.5 + 0.5) * size.height - centerY,
        labelX, labelY, visible: runner.current.visible,
      })
    }
  })
  return <group ref={runner} name={silhouette ? `multiplayer-silhouette-${silhouette}` : id === 0 ? 'runner-root' : `runner-root-${id}`} scale={avatarScale(count) * (silhouette ? .72 : 1)} dispose={null}>
    <primitive object={model} scale={sizing.scale} position={[0, sizing.offset, 0]} />
  </group>
}

function fadeObstacle(root: THREE.Group, opacity: number) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (!material.transparent) { material.transparent = true; material.needsUpdate = true }
      material.opacity = opacity
      material.depthWrite = opacity > 0.5
    }
    if (opacity < 0.5) object.castShadow = false
  })
}

function Obstacle({ item, game, id, index, count }: { item: Item; game: MutableRefObject<Game>; id: number; index: number; count: number }) {
  const root = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!root.current) return
    const fall = item.fall
    root.current.visible = !(item.kind === 'coin' && item.hit)
    const scale = avatarScale(count)
    const point = routePoint(game.current.distance, item.z, laneX(item.lane) + playerOffset(index, count) + (fall?.x ?? 0) / count)
    root.current.position.set(point.x, point.y + ((fall?.y ?? 0) + (fall ? Math.sin(fall.angle) * (item.kind === 'overhead' ? .275 : .4) : 0)) * scale, point.z)
    root.current.rotation.y = point.heading
    root.current.rotation.x = -(fall?.angle ?? 0)
    if (fall) fadeObstacle(root.current, fallOpacity(fall.age))
  })
  return <group ref={root} name={count === 1 ? `obstacle-${item.id}` : `obstacle-${item.id}-p${id}`} scale={[1 / count, avatarScale(count), avatarScale(count)]}>
  {item.kind === 'coin' ? <group position={[0, 1.1, 0]} rotation={[0, 0, 0.25]}>
    <mesh><torusGeometry args={[0.38, 0.11, 8, 24]} /><meshStandardMaterial color="#ffdb61" emissive="#d77b1a" emissiveIntensity={0.5} /></mesh>
    <mesh><sphereGeometry args={[0.12, 12, 8]} /><meshBasicMaterial color="#fff4b1" /></mesh>
  </group> : item.kind === 'overhead' ? <group>
    {[-0.9, 0.9].map(side => <mesh key={side} position={[side, 1.25, 0]} castShadow><boxGeometry args={[0.18, 2.5, 0.35]} /><meshStandardMaterial color="#824fa5" /></mesh>)}
    <mesh position={[0, 2.15, 0]} castShadow><boxGeometry args={[2, 0.65, 0.55]} /><meshStandardMaterial color="#ec79ba" /></mesh>
    <mesh position={[0, 2.15, 0.29]}><boxGeometry args={[1.5, 0.08, 0.02]} /><meshBasicMaterial color="#ffe7aa" /></mesh>
  </group> : <group>
    <mesh position={[0, item.kind === 'block' ? 1.25 : 0.45, 0]} castShadow>
      <boxGeometry args={[1.9, item.kind === 'block' ? 2.5 : 0.9, 0.8]} />
      <meshStandardMaterial color={item.kind === 'block' ? '#6d6cdb' : '#ff986f'} />
    </mesh>
    <mesh position={[0, item.kind === 'block' ? 1.25 : 0.45, 0.41]}><boxGeometry args={[1.45, 0.1, 0.02]} /><meshBasicMaterial color="#fff2b0" /></mesh>
  </group>}
  </group>
}

function World({ game, playerSnapshots, onTick, onFrame, characters, onLoadingChange, playEffect, avatars, timeOfDay, onProject, onProjectHint, showMultiplayerHint, assisted }: {
  game: MutableRefObject<Game>; playerSnapshots: PlayerSnapshot[]; onTick: () => void
  onFrame: () => void
  characters: CharacterId[]; onLoadingChange: (loading: boolean) => void
  playEffect: (effect: SoundEffect) => void
  avatars: MutableRefObject<Record<number, AvatarFrame | undefined>>; timeOfDay: TimeOfDay
  onProject: (id: number, projection: RunnerProjection) => void
  onProjectHint: (side: LobbySide, projection: RunnerProjection) => void
  showMultiplayerHint: boolean
  assisted: boolean
}) {
  const players = playerSnapshots.map(player => player.source)
  const elapsed = useRef(0)
  const stepElapsed = useRef(0)
  const jumpCue = useRef(false)
  const viewTarget = useRef(new THREE.Vector3(0, 0.5, 0))
  const target = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }, delta) => {
    onFrame()
    const g = game.current
    const wasAnimating = g.phase === 'running' || players.some(player => player.game.current.recovery > 0 || player.game.current.items.some(item => item.fall))
    advanceMultiplayer(g, players, delta).forEach(playEffect)
    const preview = g.phase !== 'running' && players.every(player => player.game.current.recovery === 0)
    const alpha = 1 - Math.exp(-delta * 7)
    const cameraPoint = routePoint(g.distance, preview ? 6 : 9)
    const lookPoint = routePoint(g.distance, preview ? 0 : -15)
    camera.position.lerp(target.set(cameraPoint.x, cameraPoint.y + (preview ? 2.5 : 5.2), cameraPoint.z), alpha)
    viewTarget.current.lerp(target.set(lookPoint.x, lookPoint.y + (preview ? 1.4 : 0.8), lookPoint.z), alpha)
    camera.lookAt(viewTarget.current)
    camera.updateMatrixWorld()
    if (g.phase === 'running' && players.some(player => player.game.current.phase === 'running' && player.game.current.jump === 0 && player.game.current.slide === 0 && player.game.current.recovery === 0)) {
      stepElapsed.current += Math.min(delta, 0.05)
      if (stepElapsed.current >= 0.32 * 15 / g.speed) {
        stepElapsed.current = 0
        playEffect('step')
      }
    } else stepElapsed.current = 0
    const cue = assisted && players.some(player => jumpNow(player.game.current))
    const cueChanged = cue !== jumpCue.current
    jumpCue.current = cue
    elapsed.current += delta
    if (wasAnimating && (elapsed.current > 0.07 || g.phase === 'over' || cueChanged)) {
      elapsed.current = 0
      onTick()
    }
  }, -1)
  return <>
    {playerSnapshots.flatMap((player, index) => player.game.items.map(item => <Obstacle key={`${player.id}-${item.id}`} item={item} game={game} id={player.id} index={index} count={players.length} />))}
    {assisted && playerSnapshots.map((player, index) => <AssistedGuidance key={player.id} game={player.source.game} items={player.game.items} id={player.id} offset={playerOffset(index, players.length)} count={players.length} />)}
    <Suspense fallback={<LoadingCharacter onLoadingChange={onLoadingChange} />}>
      <Environment game={game} timeOfDay={timeOfDay} />
      {players.map((player, index) => <Runner key={player.id} game={player.game} course={game} character={characters[player.id]} onLoadingChange={onLoadingChange} avatars={avatars} onProject={onProject} id={player.id} index={index} count={players.length} />)}
      {showMultiplayerHint && (['left', 'right'] as const).map(side => <Runner key={side} silhouette={side} game={players[0].game} course={game} character={characters[players[0].id]} avatars={avatars} onProject={(_id, projection) => onProjectHint(side, projection)} id={players[0].id} index={0} count={1} />)}
    </Suspense>
  </>
}

function EnvironmentOptions({ value, onChange }: { value: TimeOfDay; onChange: (value: TimeOfDay) => void }) {
  return <div className="environment-options" role="group" aria-label="Time of day">
    {(['evening', 'daylight'] as const).map(mode => <button key={mode} data-hand-action aria-pressed={value === mode} onClick={() => onChange(mode)}>{mode === 'evening' ? 'Evening' : 'Daylight'}</button>)}
  </div>
}

function ModeOptions({ value, onChange, disabled }: { value: Mode; onChange: (value: Mode) => void; disabled: boolean }) {
  return <div className="mode-options" role="group" aria-label="Game mode">
    <button data-hand-action disabled={disabled} aria-pressed={value === 'free-run'} onClick={() => onChange('free-run')}><strong>Free Run</strong><small>Mistakes cost up to 100 points</small></button>
    <button data-hand-action disabled={disabled} aria-pressed={value === 'survival'} onClick={() => onChange('survival')}><strong>Survival</strong><small>Five hearts. Make them last.</small></button>
  </div>
}

function App() {
  const audio = useGameAudio()
  const { playEffect } = audio
  const game = useRef<Game>(newGame())
  const initialPlayers = useMemo(() => createPlayers([0]), [])
  const players = useRef<RunnerPlayer[]>(initialPlayers)
  const avatars = useRef<Record<number, AvatarFrame | undefined>>({})
  const roster = useRef(createPlayerRoster())
  const rosterLocked = useRef(false)
  const lastPoseTime = useRef(0)
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('evening')
  const [mode, setMode] = useState<Mode>('free-run')
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY)
  const [assisted, setAssisted] = useState(false)
  const [snapshot, setSnapshot] = useState<Game>(newGame)
  const [playerSnapshots, setPlayerSnapshots] = useState<PlayerSnapshot[]>(() => snapshotPlayers(initialPlayers))
  const [characters, setCharacters] = useState<CharacterId[]>(() => CHARACTERS.map(option => option.id))
  const [selectedPlayer, setSelectedPlayer] = useState(0)
  const selectedPlayerRef = useRef(0)
  const [characterLoading, setCharacterLoading] = useState(true)
  const [characterError, setCharacterError] = useState(false)
  const handleCharacterError = useCallback(() => {
    setCharacterError(true)
    setCharacterLoading(false)
  }, [])
  const [cameraStatus, setCameraStatus] = useState('Camera off')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [calibrationMessage, setCalibrationMessage] = useState('')
  const recalibrate = useRef(false)
  const [trackedPoses, setTrackedPoses] = useState<{ id: number; pose: BodyPoint[] }[]>([])
  const [trackedPlayers, setTrackedPlayers] = useState<CameraPlayerStatus[]>([])
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 })
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [guideOpen, setGuideOpen] = useState(false)
  const [settingsView, setSettingsView] = useState<'game' | 'camera' | 'audio' | 'environment' | 'performance'>('camera')
  const [fps, setFps] = useState<{ game?: number; tracking?: number }>({})
  const frameRates = useMemo(() => ({ game: createFrameRateCounter(0), tracking: createFrameRateCounter(0) }), [])
  const previewVisibleRef = useRef(true)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const cursors = useRef<Record<Hand, HTMLDivElement | null>>({ left: null, right: null })
  const picker = useRef<HTMLDivElement>(null)
  const multiplayerHints = useRef<Record<LobbySide, HTMLButtonElement | null>>({ left: null, right: null })
  const projectMultiplayerHint = useCallback((side: LobbySide, { labelX, labelY, visible }: RunnerProjection) => {
    const hint = multiplayerHints.current[side]
    if (!hint) return
    hint.style.left = `${labelX}px`
    hint.style.top = `${labelY}px`
    hint.hidden = !visible
  }, [])
  const playerLabels = useRef<Record<number, HTMLDivElement | null>>({})
  const projectPicker = useCallback((id: number, { x, y, width, feetOffset, labelX, labelY, visible }: RunnerProjection) => {
    const label = playerLabels.current[id]
    if (label) {
      label.style.left = `${labelX}px`
      label.style.top = `${labelY}px`
      label.hidden = !visible
    }
    if (!picker.current || id !== selectedPlayerRef.current) return
    picker.current.style.left = `${x}px`
    picker.current.style.top = `${y}px`
    picker.current.style.width = `${width}px`
    picker.current.style.setProperty('--feet-offset', `${feetOffset}px`)
  }, [])
  const rescheduleDetection = useRef<(() => void) | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement>(null)
  const refresh = useCallback(() => {
    setSnapshot({ ...game.current, items: [...game.current.items] })
    setPlayerSnapshots(snapshotPlayers(players.current))
  }, [])
  const act = useCallback((action: 'left' | 'right' | 'jump' | 'slide', id = players.current[0].id) => {
    const g = players.current.find(player => player.id === id)?.game.current
    if (!g || g.phase !== 'running' || game.current.phase !== 'running') return
    if (action === 'left') g.lane = Math.max(-1, g.lane - 1) as Lane
    if (action === 'right') g.lane = Math.min(1, g.lane + 1) as Lane
    if (action === 'jump' && requestJump(g)) {
      playEffect('jump')
    }
    if (action === 'slide' && g.jump === 0 && g.recovery === 0) {
      if (g.slide === 0) playEffect('slide')
      g.slide = 0.8
    }
    refresh()
  }, [refresh, playEffect])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, [contenteditable="true"]')
        || (event.key === ' ' && event.target.closest('button')))) return
      const control = keyboardControl(event.key, players.current.length)
      if (control && game.current.phase === 'running') {
        event.preventDefault()
        if (!event.repeat || control.action === 'slide') act(control.action, players.current[control.player].id)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [act])

  useEffect(() => {
    const time = performance.now()
    frameRates.game.reset(time)
    frameRates.tracking.reset(time)
    const timer = window.setInterval(() => {
      const now = performance.now()
      setFps({ game: frameRates.game.sample(now), tracking: frameRates.tracking.sample(now) })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [frameRates])

  useEffect(() => {
    previewVisibleRef.current = sidebarOpen && settingsView === 'camera'
    rescheduleDetection.current?.()
  }, [sidebarOpen, settingsView])

  const toggleSidebar = () => {
    if (sidebarOpen && sidebarRef.current?.contains(document.activeElement)) sidebarToggleRef.current?.focus()
    setSidebarOpen(open => !open)
  }

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', updateFullscreen)
    updateFullscreen()
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  const toggleFullscreen = async () => {
    setFullscreenError('')
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (error) {
      console.error('Fullscreen unavailable', error)
      setFullscreenError('Fullscreen is unavailable in this browser. The app still fills the window.')
    }
  }

  useEffect(() => {
    frameRates.tracking.reset(performance.now())
    if (!cameraOn) return
    let cancelled = false
    let stream: MediaStream | undefined
    let detector: PoseLandmarker | undefined
    let frame = 0
    let videoFrame: number | undefined
    let lastVideoTime = -1
    const controllers = new Map<number, CameraController>()
    let lastPreview = -Infinity
    const dwell = createDualDwellController<HTMLButtonElement>()
    let hoveredButtons = new Set<HTMLButtonElement>()
    const video = videoRef.current
    const clearCursor = (time = performance.now(), pose?: BodyPoint[]) => {
      for (const cursor of Object.values(cursors.current)) if (cursor) cursor.hidden = true
      hoveredButtons.forEach(button => button.removeAttribute('data-hand-hover'))
      hoveredButtons.clear()
      dwell.update(pose ? getHandPointers(pose).map(pointer => ({ pointer, target: undefined })) : [], time)
    }
    const updateCursor = (pose: BodyPoint[], time: number) => {
      const entries = getHandPointers(pose).map(pointer => {
        const x = Math.min(window.innerWidth - 1, pointer.x * window.innerWidth)
        const y = Math.min(window.innerHeight - 1, pointer.y * window.innerHeight)
        const hit = document.elementFromPoint(x, y)?.closest('button[data-hand-action]')
        const target = hit instanceof HTMLButtonElement ? hit : undefined
        return { pointer: { ...pointer, x, y }, target, enabled: !!target && !target.disabled }
      })
      const nextHovered = new Set(entries.flatMap(entry => entry.target && entry.enabled ? [entry.target] : []))
      hoveredButtons.forEach(button => { if (!nextHovered.has(button)) button.removeAttribute('data-hand-hover') })
      nextHovered.forEach(button => button.setAttribute('data-hand-hover', 'true'))
      hoveredButtons = nextHovered
      const result = dwell.update(entries, time)
      for (const hand of ['left', 'right'] as const) {
        const cursor = cursors.current[hand]
        if (!cursor) continue
        const entry = entries.find(item => item.pointer.hand === hand)
        cursor.hidden = !entry
        if (!entry) continue
        cursor.style.left = `${entry.pointer.x}px`
        cursor.style.top = `${entry.pointer.y}px`
        cursor.style.setProperty('--dwell-angle', `${result.progress[hand] * 360}deg`)
        cursor.dataset.hover = String(entry.enabled)
      }
      result.clicks.forEach(button => { if (button.isConnected && !button.disabled) button.click() })
      return nextHovered.size > 0
    }
    const cancelDetection = () => {
      cancelAnimationFrame(frame)
      if (videoFrame !== undefined) video?.cancelVideoFrameCallback(videoFrame)
      videoFrame = undefined
    }
    const releaseSlide = (id?: number) => {
      for (const [playerId, controller] of controllers) {
        if (id !== undefined && id !== playerId) continue
        if (controller.sliding) {
          const player = players.current.find(value => value.id === playerId)
          if (player) player.game.current.slide = 0
          controller.sliding = false
        }
      }
    }
    const fail = (error: unknown) => {
      avatars.current = {}
      console.error('Camera or body tracking failed', error)
      cancelDetection()
      rescheduleDetection.current = undefined
      clearCursor()
      stream?.getTracks().forEach(track => track.stop())
      detector?.close()
      detector = undefined
      releaseSlide()
      if (video) video.srcObject = null
      if (!cancelled) {
        setCalibrationMessage('')
        setTrackedPoses([])
        setTrackedPlayers([])
        setCameraFailed(true)
        setCameraStatus('Camera or tracking unavailable. Turn the camera off and on to retry, or use keyboard controls.')
      }
    }
    const start = async () => {
      try {
        setCameraFailed(false)
        setCameraStatus('Starting camera…')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480, frameRate: { ideal: 60 } }, audio: false })
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return }
        if (!video) { stream.getTracks().forEach(track => track.stop()); return }
        video.srcObject = stream
        await video.play()
        if (cancelled) return
        setCameraStatus('Loading body tracking…')
        detector = await PoseLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
          runningMode: 'VIDEO', numPoses: MAX_PLAYERS,
        })
        if (cancelled) { detector.close(); return }
        const scheduleDetection = () => {
          if (previewVisibleRef.current && typeof video.requestVideoFrameCallback === 'function') videoFrame = video.requestVideoFrameCallback(detect)
          else frame = requestAnimationFrame(detect)
        }
        const detect = (time: number) => {
          videoFrame = undefined
          if (cancelled || !detector) return
          try {
            if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
              lastVideoTime = video.currentTime
              const result = detector.detectForVideo(video, time)
              frameRates.tracking.record()
              lastPoseTime.current = time
              const aspect = video.videoWidth / video.videoHeight
              const lobby = game.current.phase !== 'running' && players.current.every(player => player.game.current.recovery === 0)
              if (lobby && rosterLocked.current) {
                roster.current.unlock()
                rosterLocked.current = false
              }
              const assignments = roster.current.update(result.landmarks, time, aspect)
              if (lobby) {
                const ids = assignments.map(player => player.id)
                if (ids.length === 0) ids.push(0)
                if (ids.join(',') !== players.current.map(player => player.id).join(',')) {
                  players.current = ids.map(id => players.current.find(player => player.id === id) ?? createPlayers([id])[0])
                  if (!ids.includes(selectedPlayerRef.current)) {
                    selectedPlayerRef.current = ids[0]
                    setSelectedPlayer(ids[0])
                  }
                  refresh()
                }
                for (const id of controllers.keys()) if (!assignments.some(player => player.id === id)) controllers.delete(id)
              }
              if (recalibrate.current) {
                releaseSlide()
                controllers.clear()
                recalibrate.current = false
              }
              const previews: { id: number; pose: BodyPoint[] }[] = []
              const statuses: CameraPlayerStatus[] = []
              const messages: string[] = []
              const primary = players.current[0].id
              if (!assignments.some(player => player.id === primary && player.poseIndex !== undefined)) clearCursor(time)
              for (const assignment of assignments) {
                const { id, poseIndex } = assignment
                const pose = poseIndex === undefined ? [] : result.landmarks[poseIndex]
                let controller = controllers.get(id)
                if (!controller || controller.enrolledAt !== assignment.enrolledAt) {
                  if (controller && lobby) {
                    players.current = players.current.map(player => player.id === id ? createPlayers([id], game.current.mode, game.current.difficulty)[0] : player)
                    refresh()
                  }
                  controller = { body: createBodyTracker(), cross: createCrossedArmsCalibrator(), sliding: false, enrolledAt: assignment.enrolledAt }
                  controllers.set(id, controller)
                }
                const gesture = controller.cross.update(pose, time, aspect)
                if (gesture.neutral) {
                  controller.body.captureNeutral(gesture.neutral, time)
                  controller.jumpFeedback = undefined
                  releaseSlide(id)
                }
                if (gesture.active) messages.push(`P${id + 1}: ${gesture.progress === 1 ? 'Neutral reset; uncross arms.' : `Hold crossed: ${Math.round(gesture.progress * 100)}%`}`)
                if (id === primary && gesture.active) clearCursor(time, pose)
                const pointing = id === primary && !gesture.active ? updateCursor(pose, time) : false
                const motion = controller.body.update(pose, time, aspect, gesture.active)
                avatars.current[id] = {
                  pose, worldPose: poseIndex === undefined ? [] : result.worldLandmarks[poseIndex] ?? [],
                  time, aspectRatio: aspect, height: motion.height, shift: motion.shift,
                }
                previews.push({ id, pose: [...pose] })
                const player = players.current.find(value => value.id === id)?.game.current
                if (controller.jumpFeedback && controller.jumpFeedback.game !== player) controller.jumpFeedback = undefined
                if (controller.jumpFeedback?.queued && player) {
                  if (player.jumpId !== controller.jumpFeedback.jumpId) {
                    controller.jumpFeedback.queued = false
                    controller.jumpFeedback.until = time + 900
                  } else if (player.jumpBuffer === 0) controller.jumpFeedback = undefined
                }
                if (motion.status === 'tracking' && game.current.phase === 'running' && player?.phase === 'running' && !pointing && !gesture.active) {
                  player.lane = motion.lane
                  if (!motion.crouching) releaseSlide(id)
                  if (motion.jump) {
                    const jumpId = player.jumpId
                    act('jump', id)
                    if (player.jumpId !== jumpId || player.jumpBuffer > 0) {
                      controller.jumpFeedback = { game: player, jumpId: player.jumpId, until: time + 900, queued: player.jumpId === jumpId }
                    }
                  }
                  if (motion.crouching && player.jump === 0 && player.recovery === 0) {
                    if (!controller.sliding && player.slide === 0) playEffect('slide')
                    player.slide = .8
                    controller.sliding = true
                  }
                } else releaseSlide(id)
                const feedback = controller.jumpFeedback && time < controller.jumpFeedback.until ? controller.jumpFeedback : undefined
                const status = motion.status === 'lost' ? 'Tracking lost; return to your labeled position.'
                  : motion.status === 'calibrating' ? 'Stand still to calibrate.'
                    : gesture.active ? 'Recalibrating; uncross your arms.'
                      : player?.phase === 'over' ? 'Run ended'
                        : player && player.recovery > 0 ? 'Recovering; jump unavailable.'
                          : pointing ? 'Menu pointer active; move hands off buttons.'
                            : motion.crouching ? 'Sliding; stand to release.'
                              : feedback ? feedback.queued ? 'Jump queued for landing' : 'Jump registered!'
                                : motion.jumpReady ? 'Ready to jump' : 'Return to neutral and lower hands.'
                statuses.push({
                  id, ready: motion.status === 'tracking' && !gesture.active, status,
                  jumpRegistered: status === 'Jump registered!', jumpTracking: motion.jumpTracking,
                  showFeedback: motion.status !== 'tracking' || gesture.active || pointing || !motion.jumpReady
                    || feedback !== undefined || !!player && player.recovery > 0,
                })
              }
              if (time - lastPreview >= 1000 / 30 || assignments.length === 0) {
                setTrackedPoses(previews)
                setTrackedPlayers(statuses)
                setCalibrationMessage(messages.join(' · '))
                setCameraStatus(rosterLocked.current
                  ? `${assignments.filter(player => player.poseIndex !== undefined).length}/${players.current.length} players visible. Roster locked for this run.`
                  : 'Stand still to join · up to 4 players.')
                lastPreview = time
              }
            }
            rescheduleDetection.current = () => {
              cancelDetection()
              scheduleDetection()
            }
            scheduleDetection()
          } catch (error) {
            fail(error)
          }
        }
        scheduleDetection()
      } catch (error) {
        fail(error)
      }
    }
    void start()
    return () => {
      cancelled = true
      avatars.current = {}
      cancelDetection()
      rescheduleDetection.current = undefined
      clearCursor()
      detector?.close()
      releaseSlide()
      stream?.getTracks().forEach(track => track.stop())
      if (video) video.srcObject = null
    }
  }, [cameraOn, act, playEffect, refresh, frameRates])

  const startRun = () => {
    const ids = cameraOn && !cameraFailed ? roster.current.lock(lastPoseTime.current) : [0]
    if (ids.length === 0) {
      roster.current.unlock()
      setCameraStatus('No ready players visible. Stand still in frame before starting.')
      return
    }
    rosterLocked.current = true
    if (!cameraOn || cameraFailed) roster.current.lock(lastPoseTime.current, ids)
    game.current = { ...newGame(mode, difficulty), phase: 'running' }
    players.current = createPlayers(ids, mode, difficulty, true)
    refresh()
  }
  const endRun = () => {
    game.current.phase = 'over'
    game.current.jumpBuffer = 0
    game.current.recovery = 0
    game.current.jump = 0
    game.current.lastJumpAt = -Infinity
    game.current.slide = 0
    game.current.items = []
    stopPlayers(players.current)
    roster.current.unlock()
    rosterLocked.current = false
    refresh()
  }
  const changeCharacter = (direction: -1 | 1) => {
    setCharacterLoading(true)
    setCharacterError(false)
    setCharacters(values => values.map((value, id) => id === selectedPlayer ? cycleCharacter(value, direction) : value))
  }
  const changeDifficulty = (value: number) => {
    setDifficulty(value)
    game.current.difficulty = value
    setPlayerDifficulty(players.current, value)
    refresh()
  }
  const menuVisible = snapshot.phase !== 'running' && playerSnapshots.every(player => player.game.recovery === 0)
  const jumpingPlayers = assisted ? playerSnapshots.filter(player => jumpNow(player.game)) : []
  const assistedJumpNow = jumpingPlayers.length > 0
  const selectedCharacter = CHARACTERS.find(option => option.id === characters[selectedPlayer])!
  const waitingForPlayers = cameraOn && !cameraFailed && !playerSnapshots.every(player => trackedPlayers.some(track => track.id === player.id && track.ready))
  const primaryGame = playerSnapshots[0].game
  const cameraFeedback = trackedPlayers.filter(player => player.showFeedback)
  return <main className="app">
    <div className="floating-controls">
      <button className="fullscreen-button" data-hand-action={fullscreen ? true : undefined} onClick={() => void toggleFullscreen()} title="Use a mouse click or keyboard to enter browser fullscreen">{fullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'} <span aria-hidden="true">⛶</span></button>
      <button ref={sidebarToggleRef} className="sidebar-toggle" data-hand-action aria-expanded={sidebarOpen} aria-controls="game-controls" onClick={toggleSidebar}>{sidebarOpen ? 'HIDE CONTROLS' : 'SHOW CONTROLS'} <span aria-hidden="true">{sidebarOpen ? '→' : '☰'}</span></button>
      {snapshot.phase === 'running' && <button className="fullscreen-button" data-hand-action onClick={endRun}>END RUN</button>}
    </div>
    {fullscreenError && <p className="fullscreen-error" role="status">{fullscreenError}</p>}
    {calibrationMessage && <p className="calibration-status" role="status">{calibrationMessage}</p>}
    {audio.error && !(sidebarOpen && settingsView === 'audio') && <div className="audio-error" role="alert">
      <span>Sound unavailable: {audio.error}</span>
      <button data-hand-action onClick={() => { setSidebarOpen(true); setSettingsView('audio') }}>OPEN AUDIO SETTINGS</button>
    </div>}
      <section className="game-card" aria-label="Game">
        <div className="game-view">
          <SceneBoundary key={characters.join('-')} onError={handleCharacterError}>
            <Canvas shadows camera={{ position: [0, 2.5, 6], fov: 50 }} onCreated={({ camera }) => camera.lookAt(0, 0.5, 0)}>
              <World game={game} playerSnapshots={playerSnapshots} onTick={refresh} onFrame={frameRates.game.record} characters={characters} onLoadingChange={setCharacterLoading} playEffect={playEffect} avatars={avatars} timeOfDay={timeOfDay} onProject={projectPicker} onProjectHint={projectMultiplayerHint} showMultiplayerHint={menuVisible && playerSnapshots.length === 1} assisted={assisted} />
            </Canvas>
          </SceneBoundary>
          <div className="run-hud">
          {!menuVisible && playerSnapshots.length === 1 && <div className="scoreboard"><div><small>SCORE</small><strong>{String(scoreOf(primaryGame)).padStart(5, '0')}</strong></div><div><small>DISTANCE</small><strong>{Math.floor(primaryGame.distance)}<em> m</em></strong></div><div><small>STARS</small><strong><em>✦ </em>{primaryGame.coins}</strong></div>
            {mode === 'survival' && <div><small>HEARTS</small><span className="hearts" role="img" aria-label={`${primaryGame.lives} of 5 hearts remaining`}>{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < primaryGame.lives ? '' : 'empty'} aria-hidden="true">♥</span>)}</span></div>}
          </div>}
          {playerSnapshots.length > 1 && <div className="multiplayer-hud" aria-label="Player scores">{playerSnapshots.map(player => <div key={player.id} className={`player-score${player.game.phase === 'over' ? ' out' : ''}`} style={{ borderColor: PLAYER_COLORS[player.id] }}>
            <strong style={{ color: PLAYER_COLORS[player.id] }}>P{player.id + 1}</strong><span>{scoreOf(player.game)} pts · {player.game.coins} stars</span>
            <small>{player.game.phase === 'over' ? 'OUT' : player.game.recovery > 0 ? player.game.mode === 'survival' ? 'Heart lost' : `Stumble −${player.game.lastPenalty}` : player.game.mode === 'survival' ? `${player.game.lives}/5 hearts` : 'Free Run'}</small>
          </div>)}</div>}
          {snapshot.phase === 'running' && <div className="area-badge" role="status">{routeArea(snapshot.distance).label}</div>}
          {cameraOn && snapshot.phase === 'running' && (cameraFeedback.length > 0 || trackedPlayers.length === 0) && <div className={`tracking-hud${cameraFeedback.length > 1 ? ' multiplayer' : ''}`} role="status" aria-label="Camera tracking">
            {trackedPlayers.length === 0 ? <p>{cameraStatus}</p> : cameraFeedback.map(player => <p key={player.id} className={player.jumpRegistered ? 'registered' : ''}>
              <strong>P{player.id + 1} · {player.status}</strong>
            </p>)}
          </div>}
          </div>
          {playerSnapshots.length > 1 && playerSnapshots.map(player => <div key={player.id} ref={element => { playerLabels.current[player.id] = element }} className="player-label" style={{ borderColor: PLAYER_COLORS[player.id], color: PLAYER_COLORS[player.id] }}>P{player.id + 1}</div>)}
          {snapshot.phase === 'running' && <div className="speedometer">
            <span aria-hidden="true"><small>MAX</small><b>{MAX_RUN_SPEED}</b></span>
            <div className="speed-track" role="meter" aria-label="Running speed" aria-valuemin={MIN_RUN_SPEED} aria-valuemax={MAX_RUN_SPEED} aria-valuenow={snapshot.speed} aria-valuetext={`${snapshot.speed.toFixed(1)} meters per second`}>
              <div className="speed-fill" style={{ height: `${(snapshot.speed - MIN_RUN_SPEED) / (MAX_RUN_SPEED - MIN_RUN_SPEED) * 100}%` }} />
            </div>
            <span aria-hidden="true"><small>MIN</small><b>{MIN_RUN_SPEED}</b></span>
            <strong className="speed-current" aria-hidden="true">{snapshot.speed.toFixed(1)}<small>m/s</small></strong>
          </div>}
          {assisted && snapshot.phase === 'running' && <p className={`assist-cue${assistedJumpNow ? ' active' : ''}`} role="status">{assistedJumpNow ? `${playerSnapshots.length > 1 ? `${jumpingPlayers.map(player => `P${player.id + 1}`).join(', ')} · ` : ''}JUMP NOW` : 'ASSISTED · Jump in the green zone'}</p>}
          {playerSnapshots.length === 1 && primaryGame.recovery > 0 && <p className="impact-status" role="status">{primaryGame.mode === 'survival' ? `Heart lost · ${primaryGame.lives} remaining` : primaryGame.lastPenalty ? `Stumble! −${primaryGame.lastPenalty} points` : 'Stumble! Keep going.'}</p>}
          {menuVisible && <>
            {playerSnapshots.length === 1 && (['left', 'right'] as const).map(side => <button key={side} ref={element => { multiplayerHints.current[side] = element }} className={`multiplayer-hint ${side}`} data-hand-action aria-label={`${side === 'left' ? 'Left' : 'Right'} multiplayer slot: open camera to join, up to 4 players`} onClick={() => { setSettingsView('camera'); setSidebarOpen(true) }}>+ Join</button>)}
            <div ref={picker} className="on-lane-selector" role="group" aria-label="Character selection">
              <button className="character-arrow previous" data-hand-action aria-label="Previous character" disabled={characterLoading || characterError} onClick={() => changeCharacter(-1)}>‹</button>
              <button className="character-arrow next" data-hand-action aria-label="Next character" disabled={characterLoading || characterError} onClick={() => changeCharacter(1)}>›</button>
              <div className="character-name" role="status"><span className="character-swatch" style={{ backgroundColor: selectedCharacter.color }} aria-hidden="true" />{selectedCharacter.name}</div>
            </div>
            <section className="menu-dock" aria-label="Run setup">
              {snapshot.phase === 'over' && <h2>{playerSnapshots.length > 1 ? 'Run complete' : `${scoreOf(primaryGame)} points`}</h2>}
              {playerSnapshots.length > 1 && <div className="player-select" role="group" aria-label="Choose player character">{playerSnapshots.map(player => <button key={player.id} data-hand-action aria-pressed={selectedPlayer === player.id} onClick={() => { selectedPlayerRef.current = player.id; setSelectedPlayer(player.id) }}>P{player.id + 1}</button>)}</div>}
              <button className="primary-button" data-hand-action disabled={characterLoading || characterError || waitingForPlayers} onClick={startRun}>{characterLoading ? 'LOADING GAME' : waitingForPlayers ? 'WAITING FOR PLAYERS' : snapshot.phase === 'over' ? 'PLAY AGAIN' : 'START RUN'} <span>↗</span></button>
              <button className="mode-shortcut" data-hand-action aria-label={`Game settings: ${mode === 'free-run' ? 'Free Run' : 'Survival'}`} onClick={() => { setSettingsView('game'); setSidebarOpen(true) }}>{mode === 'free-run' ? 'Free Run' : 'Survival'} <span aria-hidden="true">⚙</span></button>
            </section>
          </>}
          {characterLoading && <div className="asset-status" role="status">Loading game assets…</div>}
        </div>
      </section>
      <aside ref={sidebarRef} id="game-controls" className="sidebar" aria-label="Game controls and settings" hidden={!sidebarOpen}>
        <div className="sidebar-switcher">
          <button data-hand-action aria-pressed={settingsView === 'game'} aria-controls="game-settings" onClick={() => setSettingsView('game')}>GAME</button>
          <button data-hand-action aria-pressed={settingsView === 'camera'} aria-controls="camera-controls" onClick={() => setSettingsView('camera')}>CAMERA &amp; GUIDE</button>
          <button data-hand-action aria-pressed={settingsView === 'audio'} aria-controls="audio-controls" onClick={() => setSettingsView('audio')}>AUDIO</button>
          <button data-hand-action aria-pressed={settingsView === 'environment'} aria-controls="environment-controls" onClick={() => setSettingsView('environment')}>SCENERY</button>
          <button data-hand-action aria-pressed={settingsView === 'performance'} aria-controls="performance-controls" onClick={() => setSettingsView('performance')}>FPS</button>
        </div>
        <section id="game-settings" className="panel difficulty-panel" aria-label="Game settings" hidden={settingsView !== 'game'}>
          <div className="game-mode-control"><ModeOptions value={mode} onChange={setMode} disabled={snapshot.phase === 'running'} /></div>
          <DifficultyControl id="sidebar-difficulty" value={difficulty} onChange={changeDifficulty} />
          <button className="assisted-toggle" data-hand-action aria-pressed={assisted} aria-describedby="assisted-description" onClick={() => setAssisted(!assisted)}>Assisted mode <span>{assisted ? 'ON' : 'OFF'}</span></button>
          <p id="assisted-description" className="difficulty-timing">Highlight your lane and green takeoff zones before low barriers. Jump inside the zone. Overhead obstacles still need a slide; avoid tall blocks. Guidance only, not automatic jumping.</p>
        </section>
        <div id="camera-controls" className="camera-controls" hidden={settingsView !== 'camera'}>
        <div className="panel camera-panel"><div className="panel-heading"><div><span className="section-number">01 / YOUR CAMERA</span><h2>Get in frame<span>.</span></h2></div><span className="panel-icon">⌗</span></div>
          <div className="camera-preview"><video ref={videoRef} autoPlay muted playsInline onLoadedMetadata={event => setVideoSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} />
            {cameraOn && <svg className="pose-overlay" viewBox={`0 0 ${videoSize.width} ${videoSize.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              {trackedPoses.map(({ id, pose }) => <g key={id} data-player-id={id} style={{ color: PLAYER_COLORS[id] }}>
                {PoseLandmarker.POSE_CONNECTIONS.map(({ start, end }) => {
                  const from = pose[start], to = pose[end]
                  return isVisiblePoint(from) && isVisiblePoint(to) ? <line key={`${start}-${end}`} style={{ stroke: PLAYER_COLORS[id] }} x1={from.x * videoSize.width} y1={from.y * videoSize.height} x2={to.x * videoSize.width} y2={to.y * videoSize.height} vectorEffect="non-scaling-stroke" /> : null
                })}
                {pose.map((point, index) => isVisiblePoint(point) ? <circle key={index} style={{ fill: PLAYER_COLORS[id] }} cx={point.x * videoSize.width} cy={point.y * videoSize.height} r={videoSize.width / 160} /> : null)}
                {isVisiblePoint(pose[11]) && <text x={pose[11].x * videoSize.width} y={pose[11].y * videoSize.height - 14} transform={`translate(${2 * pose[11].x * videoSize.width},0) scale(-1,1)`} fill={PLAYER_COLORS[id]} fontSize="22" fontWeight="bold">P{id + 1}</text>}
              </g>)}
            </svg>}
            <div className="camera-placeholder">{!cameraOn && <><span className="camera-symbol">◎</span><strong>YOUR SPACE TO MOVE</strong><small>Camera preview appears here</small></>}</div><span className="preview-corner tl" /><span className="preview-corner tr" /><span className="preview-corner bl" /><span className="preview-corner br" /><div className="preview-label"><span /> {cameraOn ? 'CAMERA ON' : 'CAMERA OFF'}</div></div>
          <p className="camera-hint" role="status">{cameraOn ? cameraStatus : 'Show your head and shoulders. Hold still to join.'}</p>
          <button className="camera-button" data-hand-action onClick={() => { setCameraOn(!cameraOn); setCameraFailed(false); setFps(current => ({ ...current, tracking: undefined })); setTrackedPoses([]); setTrackedPlayers([]); setCalibrationMessage(''); recalibrate.current = false; if (cameraOn) { setCameraStatus('Camera off'); if (game.current.phase !== 'running') { roster.current.reset(); players.current = createPlayers([0]); selectedPlayerRef.current = 0; setSelectedPlayer(0); refresh() } } }}>{cameraOn ? 'TURN CAMERA OFF' : 'ENABLE CAMERA'} <span>↗</span></button>
          <div className="player-roster" aria-label="Webcam players">
            <strong>{snapshot.phase === 'running' ? `${playerSnapshots.length} players · roster locked` : 'Up to 4 players'}</strong>
            {trackedPlayers.map(player => <p key={player.id} style={{ color: PLAYER_COLORS[player.id] }}>P{player.id + 1}: {player.status}{player.ready && <small>{player.jumpTracking === 'hips' ? 'Hip-assisted tracking' : 'Shoulder-only tracking'}</small>}</p>)}
            <small>Stand side by side before starting.</small>
          </div>
          {cameraOn && menuVisible && <button className="camera-button" data-hand-action onClick={() => { roster.current.reset(); rosterLocked.current = false; players.current = createPlayers([0]); avatars.current = {}; setTrackedPlayers([]); setTrackedPoses([]); selectedPlayerRef.current = 0; setSelectedPlayer(0); refresh() }}>RESET PLAYERS</button>}
          {cameraOn && <button className="calibration-button" data-hand-action onClick={() => { recalibrate.current = true; setCameraStatus('Hold your neutral seated or standing pose to recalibrate.') }}>
            <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></svg>
            Recalibrate neutral position
          </button>}
          <div className="privacy">✳ &nbsp; Your camera stays on your device.</div>
        </div>
        <div className="panel controls-panel">
          <button className="guide-toggle" data-hand-action aria-expanded={guideOpen} aria-controls="movement-guide" onClick={() => setGuideOpen(!guideOpen)}>How to play <span aria-hidden="true">{guideOpen ? '−' : '+'}</span></button>
          <div id="movement-guide" hidden={!guideOpen}>
          <div className="control-row"><span className="control-icon">↔</span><div><strong>Move left or right</strong><small>Lean left or right to switch lanes</small></div><kbd>← →</kbd></div>
          <div className="control-row"><span className="control-icon">↑</span><div><strong>Jump over</strong><small>Rise up or raise both hands</small></div><kbd>↑</kbd></div>
          <div className="control-row"><span className="control-icon">↓</span><div><strong>Slide under</strong><small>Crouch to slide; stand to release</small></div><kbd>↓</kbd></div>
          <div className="tip"><span>✦</span><p><strong>Choose your challenge</strong>Free Run deducts up to 100 points per mistake. Survival gives each player five hearts; the run ends when everyone is out.</p></div>
          <div className="tip"><span>↗</span><p><strong>Two hands, two cursors</strong>Aim either hand and hold over a button for 0.6 seconds. Green L is your left hand; blue R is your right. Cross both forearms across your chest and hold still for one second to capture a new neutral position. Uncross before repeating. Tracking continues with this sidebar hidden.</p></div>
          </div>
        </div>
        </div>
        <div className="audio-view" hidden={settingsView !== 'audio'}><AudioSettings audio={audio} /></div>
        <section id="environment-controls" className="panel environment-panel" hidden={settingsView !== 'environment'} aria-label="Scenery settings">
          <div className="panel-heading"><div><span className="section-number">04 / YOUR WORLD</span><h2>Choose your light<span>.</span></h2></div></div>
          <EnvironmentOptions value={timeOfDay} onChange={setTimeOfDay} />
          <p className="audio-message">Switch between the moonlit evening forest and a bright daylight run, without restarting the game or camera.</p>
        </section>
        <section id="performance-controls" className="panel performance-panel" hidden={settingsView !== 'performance'} aria-label="Performance">
          <div className="panel-heading"><h2>Performance<span>.</span></h2></div>
          <dl className="fps-readouts">
            <div><dt title="Rendered game frames per second">Game FPS</dt><dd>{characterError ? 'Unavailable' : fps.game === undefined ? 'Warming up' : fps.game.toFixed(1)}</dd></div>
            <div><dt title="Completed pose-tracking frames per second">Tracking FPS</dt><dd>{!cameraOn ? 'Camera off' : cameraFailed ? 'Unavailable' : fps.tracking === undefined ? 'Warming up' : fps.tracking.toFixed(1)}</dd></div>
          </dl>
          <p className="audio-message">Updated every second.</p>
        </section>
      </aside>
    {(['left', 'right'] as const).map(hand => <div key={hand} ref={node => { cursors.current[hand] = node }} className={`hand-cursor ${hand}`} hidden aria-hidden="true"><span>{hand === 'left' ? 'L' : 'R'}</span></div>)}
  </main>
}

export default App
