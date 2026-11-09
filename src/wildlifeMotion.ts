export type AnimalKind = 'frog' | 'mouse' | 'rabbit' | 'deer'

export const GROUND_ANIMALS = Array.from({ length: 8 }, (_, index) => {
  const kind = (['frog', 'mouse', 'rabbit', 'deer'] as const)[index % 4]
  const duration = kind === 'frog' ? 8 : kind === 'mouse' ? 5.5 : kind === 'rabbit' ? 6 : 5
  const period = 18 + index * 1.3
  return {
    kind, duration, period,
    offset: index < 4 ? duration * [0.4, 0.35, 0.55, 0.7][index] : period / 2,
    depth: 12 + index % 4 * 7 + Math.floor(index / 4) * 5,
    direction: (index + Math.floor(index / 4)) % 2 ? -1 : 1,
  }
})

export function groundAnimalMotion(index: number, time: number) {
  const animal = GROUND_ANIMALS[index]
  const age = time + animal.offset
  const elapsed = age % animal.period
  const hopping = animal.kind === 'frog' || animal.kind === 'rabbit'
  const hopRate = animal.kind === 'frog' ? 2 : 3
  const step = Math.min(1, (elapsed * hopRate % 1) / 0.72)
  const progress = hopping
    ? (Math.floor(elapsed * hopRate) + step * step * (3 - 2 * step)) / (animal.duration * hopRate)
    : elapsed / animal.duration
  return {
    cycle: Math.floor(age / animal.period), elapsed,
    visible: elapsed < animal.duration,
    x: animal.direction * (-12 + 24 * progress),
    hop: hopping ? Math.sin(step * Math.PI) * (animal.kind === 'frog' ? 0.22 : 0.3) : Math.abs(Math.sin(elapsed * 14)) * 0.025,
    gait: Math.sin(elapsed * (animal.kind === 'mouse' ? 22 : hopping ? hopRate * Math.PI * 2 : 12)),
  }
}

export function birdMotion(index: number, time: number) {
  const angle = time * (0.16 + index * 0.012) + index * Math.PI * 0.4
  return {
    x: Math.sin(angle) * 22,
    y: 4 + index * 0.45 + Math.sin(angle * 2) * 0.35,
    z: -42 + Math.cos(angle) * 24,
    heading: Math.atan2(Math.sin(angle) * 24, Math.cos(angle) * 22),
    flap: Math.sin(time * 9 + index * 2) * 0.75 + 0.15,
  }
}
