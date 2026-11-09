export type SoundEffect = 'step' | 'jump' | 'slide' | 'coin' | 'crash'
export const SOUND_FILES = {
  stepA: 'footstep_concrete_000.ogg',
  stepB: 'footstep_concrete_001.ogg',
  jump: 'impactSoft_medium_000.ogg',
  slide: 'footstep_grass_000.ogg',
  coin: 'impactBell_heavy_004.ogg',
  crash: 'impactWood_heavy_000.ogg',
} as const

export const MUSIC_MELODY = [69, 72, 76, 74, 72, 69, 67, 64, 65, 69, 72, 76, 74, 71, 67, 72] as const
const bass = [45, 45, 45, 45, 41, 41, 41, 41, 48, 48, 48, 48, 43, 43, 43, 43]
const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]
export const MUSIC_DURATION = MUSIC_MELODY.length * 0.5

export function validateVolume(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Audio volume must be between 0 and 1')
  return value
}

async function renderMusic(sampleRate: number) {
  const offline = new OfflineAudioContext(2, Math.ceil(sampleRate * MUSIC_DURATION), sampleRate)
  const note = (midi: number, time: number, duration: number, volume: number, type: OscillatorType) => {
    const oscillator = offline.createOscillator()
    const gain = offline.createGain()
    oscillator.type = type
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(volume, time + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration - 0.02)
    gain.gain.linearRampToValueAtTime(0, time + duration)
    oscillator.connect(gain).connect(offline.destination)
    oscillator.start(time)
    oscillator.stop(time + duration)
  }
  MUSIC_MELODY.forEach((midi, i) => note(midi, i * 0.5, 0.38, 0.07, 'triangle'))
  bass.forEach((midi, i) => note(midi, i * 0.5, 0.47, 0.12, 'sine'))
  chords.forEach((chord, i) => chord.forEach(midi => note(midi, i * 2, 1.98, 0.025, 'sine')))
  return offline.startRendering()
}

export class GameAudio {
  private root: string
  private context: AudioContext | undefined
  private musicGain: GainNode | undefined
  private effectsGain: GainNode | undefined
  private music: AudioBuffer | undefined
  private musicSource: AudioBufferSourceNode | undefined
  private buffers = new Map<string, AudioBuffer>()
  private effects = new Set<AudioBufferSourceNode>()
  private loading: Promise<void> | undefined
  private ready = false
  private disposed = false
  private active = true
  private step = 0
  private musicVolume = 0.25
  private effectsVolume = 0.6

  constructor(root: string) {
    this.root = root
  }

  setVolumes(music: number, effects: number) {
    this.musicVolume = validateVolume(music)
    this.effectsVolume = validateVolume(effects)
    if (this.context && this.context.state !== 'closed') {
      this.musicGain?.gain.setTargetAtTime(music, this.context.currentTime, 0.03)
      this.effectsGain?.gain.setTargetAtTime(effects, this.context.currentTime, 0.03)
    }
  }

  async unlock() {
    if (this.disposed) return
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' })
      this.musicGain = this.context.createGain()
      this.effectsGain = this.context.createGain()
      this.musicGain.connect(this.context.destination)
      this.effectsGain.connect(this.context.destination)
      this.musicGain.gain.value = this.musicVolume
      this.effectsGain.gain.value = this.effectsVolume
    }
    const context = this.context
    await context.resume()
    if (this.disposed) return
    if (context.state !== 'running') throw new Error('Sound is blocked. Click Enable sound to retry.')
    if (!this.loading) this.loading = this.load(context)
    try {
      await this.loading
    } catch (error) {
      this.loading = undefined
      throw error
    }
    if (!this.disposed) this.startMusic()
  }

  private async load(context: AudioContext) {
    const entries = Object.entries(SOUND_FILES)
    const [music, ...sounds] = await Promise.all([
      renderMusic(context.sampleRate),
      ...entries.map(async ([, file]) => {
        const response = await fetch(this.root + file)
        if (!response.ok) throw new Error(`Sound asset failed to load (${response.status}): ${file}`)
        return context.decodeAudioData(await response.arrayBuffer())
      }),
    ])
    if (this.disposed) return
    this.music = music
    entries.forEach(([key], i) => this.buffers.set(key, sounds[i]))
    this.ready = true
  }

  private startMusic() {
    if (!this.active || !this.ready || !this.context || !this.music || !this.musicGain || this.musicSource) return
    const source = this.context.createBufferSource()
    source.buffer = this.music
    source.loop = true
    source.connect(this.musicGain)
    source.start()
    this.musicSource = source
  }

  setActive(active: boolean) {
    this.active = active
    if (active) this.startMusic()
    else {
      this.musicSource?.stop()
      this.musicSource?.disconnect()
      this.musicSource = undefined
      this.effects.forEach(source => source.stop())
      this.effects.clear()
    }
  }

  play(effect: SoundEffect) {
    if (!this.active || !this.ready || this.disposed || this.context?.state !== 'running' || !this.effectsGain || this.effectsVolume === 0) return
    const key = effect === 'step' ? this.step++ % 2 ? 'stepA' : 'stepB' : effect
    const buffer = this.buffers.get(key)
    if (!buffer) throw new Error(`Sound effect is not loaded: ${key}`)
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    source.buffer = buffer
    source.playbackRate.value = effect === 'coin' ? 1.7 : effect === 'jump' ? 1.4 : 1
    gain.gain.value = effect === 'step' ? 0.25 : effect === 'crash' ? 0.55 : 0.4
    source.connect(gain).connect(this.effectsGain)
    source.onended = () => {
      this.effects.delete(source)
      source.disconnect()
      gain.disconnect()
    }
    this.effects.add(source)
    source.start()
  }

  dispose() {
    this.disposed = true
    this.setActive(false)
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(error => console.error('Audio context could not close', error))
    }
  }
}
