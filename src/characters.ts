export const CHARACTERS = [
  { id: 'skaterMaleA', name: 'Red-shirt skater', color: '#ee705e' },
  { id: 'skaterFemaleA', name: 'Dark-outfit skater', color: '#36404b' },
  { id: 'criminalMaleA', name: 'White-outfit agent', color: '#dce9ec' },
  { id: 'cyborgFemaleA', name: 'Cyborg', color: '#80adbf' },
] as const

export type CharacterId = typeof CHARACTERS[number]['id']

export function cycleCharacter(character: CharacterId, direction: -1 | 1): CharacterId {
  const index = CHARACTERS.findIndex(option => option.id === character)
  return CHARACTERS[(index + direction + CHARACTERS.length) % CHARACTERS.length].id
}
