import { useCallback, useEffect, useRef, useState } from 'react'
import { GameAudio, validateVolume } from './gameAudio'
import type { SoundEffect } from './gameAudio'

export function useGameAudio() {
  const engine = useRef<GameAudio | undefined>(undefined)
  const [musicVolume, setMusic] = useState(0.25)
  const [effectsVolume, setEffects] = useState(0.6)
  const [status, setStatus] = useState<'locked' | 'loading' | 'ready' | 'error'>('locked')
  const [error, setError] = useState('')
  const unlockRef = useRef<(() => Promise<void>) | undefined>(undefined)
  useEffect(() => {
    const audio = new GameAudio(`${import.meta.env.BASE_URL}assets/kenney/sounds/`)
    engine.current = audio
    let mounted = true
    let unlocking = false
    let state: typeof status = 'locked'
    const unlock = async () => {
      if (unlocking) return
      unlocking = true
      state = 'loading'
      setStatus('loading')
      setError('')
      try {
        await audio.unlock()
        if (mounted) {
          state = 'ready'
          setStatus('ready')
        }
      } catch (cause) {
        if (mounted) {
          console.error('Game audio failed', cause)
          state = 'error'
          setStatus('error')
          setError(cause instanceof Error ? cause.message : 'Sound could not start. Retry with a mouse click.')
        }
      } finally {
        unlocking = false
      }
    }
    unlockRef.current = unlock
    const interact = (event: Event) => {
      if (event.isTrusted && state === 'locked') void unlock()
    }
    const visibility = () => audio.setActive(!document.hidden)
    visibility()
    document.addEventListener('pointerdown', interact)
    document.addEventListener('keydown', interact)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      mounted = false
      engine.current = undefined
      unlockRef.current = undefined
      document.removeEventListener('pointerdown', interact)
      document.removeEventListener('keydown', interact)
      document.removeEventListener('visibilitychange', visibility)
      audio.dispose()
    }
  }, [])
  useEffect(() => engine.current?.setVolumes(musicVolume, effectsVolume), [musicVolume, effectsVolume])
  const unlock = useCallback(() => { void unlockRef.current?.() }, [])
  const playEffect = useCallback((effect: SoundEffect) => engine.current?.play(effect), [])
  const setPowerUpAmbience = useCallback((sword: boolean, invincibility: boolean) => engine.current?.setPowerUpAmbience(sword, invincibility), [])
  return {
    musicVolume, effectsVolume, status, error, unlock, playEffect, setPowerUpAmbience,
    setMusicVolume: (value: number) => setMusic(validateVolume(value)),
    setEffectsVolume: (value: number) => setEffects(validateVolume(value)),
  }
}
