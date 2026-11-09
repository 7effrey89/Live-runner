export function sceneryZ(row: number, distance: number) {
  return 8 - ((row * 12 - distance) % 216 + 216) % 216
}
export type TimeOfDay = 'evening' | 'daylight'
