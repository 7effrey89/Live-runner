export const SYNTH_EFFECTS = ['powerup', 'sword', 'blaster', 'fireball', 'abilityHit', 'countdown', 'expire'] as const
export type AbilitySound = typeof SYNTH_EFFECTS[number]
export const AMBIENT_SOUNDS = ['saberHum', 'invincibility'] as const
export type AmbientSound = typeof AMBIENT_SOUNDS[number]
export const SOUND_DURATIONS: Record<AbilitySound | AmbientSound, number> = {
  powerup: .55, sword: .36, blaster: .18, fireball: .4, abilityHit: .28,
  countdown: .09, expire: .4, saberHum: 2, invincibility: 2,
}

export function synthesizeAbilitySound(sound: AbilitySound | AmbientSound, sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported synthesis sample rate')
  const duration = SOUND_DURATIONS[sound]
  const samples = new Float32Array(Math.ceil(duration * sampleRate))
  const loop = sound === 'saberHum' || sound === 'invincibility'
  let phase = 0
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate
    const progress = time / duration
    const noise = Math.sin(i * 12.9898 + 78.233) * 43758.5453 % 1
    let value: number
    if (sound === 'saberHum') {
      value = (Math.sin(2 * Math.PI * 80 * time) + .4 * Math.sin(2 * Math.PI * 120 * time)
        + .2 * Math.sin(2 * Math.PI * 240 * time)) * (.12 + .025 * Math.sin(Math.PI * time))
    } else if (sound === 'invincibility') {
      const frequencies = [440, 554.365, 659.255, 830.609]
      const step = Math.floor(time * 4)
      const noteTime = time % .25
      value = Math.sin(2 * Math.PI * frequencies[step % 4] * noteTime) * Math.sin(Math.PI * noteTime / .25) ** 2 * .18
    } else {
      const frequency = sound === 'powerup' ? 350 + progress * 950
        : sound === 'sword' ? 100 + Math.sin(progress * Math.PI) * 360
          : sound === 'blaster' ? 1400 * Math.exp(-progress * 5) + 60
            : sound === 'fireball' ? 140 - progress * 95
              : sound === 'abilityHit' ? 220 * Math.exp(-progress * 4)
                : sound === 'countdown' ? 620 : 650 - progress * 450
      phase += 2 * Math.PI * frequency / sampleRate
      value = Math.sin(phase) + .25 * Math.sin(phase * 2)
      if (sound === 'sword') value += noise * .7 * Math.sin(progress * Math.PI)
      if (sound === 'fireball' || sound === 'abilityHit') value = value * .3 + noise * .9
      const envelope = Math.min(1, time / .012) * (1 - progress) ** 2
      value *= envelope * .45
    }
    if (loop) value *= Math.min(1, time * 300, (duration - time) * 300)
    samples[i] = Math.tanh(value)
  }
  return samples
}
