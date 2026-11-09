export type AreaKind = 'forest' | 'town' | 'park' | 'bridge' | 'lake' | 'woodland'
export type RouteArea = { id: number; kind: AreaKind; label: string; start: number; end: number; variant: number }
export const ROUTE_LAP_LENGTH = 2400
const labels: Record<AreaKind, string> = {
  forest: 'Whispering Woods', town: 'Lantern Village', park: 'Willow Park',
  bridge: 'Timber Crossing', lake: 'Swan Lake Shore', woodland: 'Woodland Camp',
}
const orders: AreaKind[][] = [
  ['forest', 'town', 'park', 'bridge', 'lake', 'woodland'],
  ['town', 'park', 'woodland', 'bridge', 'lake', 'forest'],
  ['park', 'town', 'forest', 'bridge', 'lake', 'woodland'],
]
const layouts = Array.from({ length: 24 }, (_, lap) => {
  const lengths: Record<AreaKind, number> = {
    forest: 260 + lap * 37 % 80, town: 320 + lap * 53 % 100,
    park: 300 + lap * 29 % 100, bridge: 120, lake: 720 + lap * 47 % 160, woodland: 0,
  }
  lengths.woodland = ROUTE_LAP_LENGTH - Object.values(lengths).reduce((sum, length) => sum + length, 0)
  let start = 0
  return orders[lap % orders.length].map((kind, index) => {
    const area = { kind, start, end: start + lengths[kind], variant: (lap * 7 + index * 11) % 3 }
    start = area.end
    return area
  })
})

export function routeArea(distance: number): RouteArea {
  const position = Math.max(0, distance)
  const lap = Math.floor(position / ROUTE_LAP_LENGTH)
  const local = position - lap * ROUTE_LAP_LENGTH
  const layout = layouts[lap % layouts.length]
  const index = layout.findIndex(area => local < area.end)
  const area = layout[index]
  return { ...area, id: lap * 6 + index, label: labels[area.kind], start: area.start + lap * ROUTE_LAP_LENGTH, end: area.end + lap * ROUTE_LAP_LENGTH }
}

export const routeCenter = (distance: number) => 10 * (1 - Math.cos(distance / 130)) + 4 * (1 - Math.cos(distance / 310))
export const routeHeading = (distance: number) => -Math.atan(10 / 130 * Math.sin(distance / 130) + 4 / 310 * Math.sin(distance / 310))
const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

export function routeElevation(distance: number) {
  const area = routeArea(distance)
  return area.kind === 'bridge' ? 0.35 * smooth((distance - area.start) / 24) * smooth((area.end - distance) / 24) : 0
}

// Render all actors in the same curved coordinate system; collisions stay lane-based.
export function routePoint(distance: number, z: number, lateral = 0) {
  const absolute = distance - z
  const heading = routeHeading(absolute)
  return {
    x: routeCenter(absolute) - routeCenter(distance) + lateral * Math.cos(heading),
    y: routeElevation(absolute),
    z: z - lateral * Math.sin(heading),
    heading,
  }
}

export function waterSpan(distance: number): [number, number] | undefined {
  const area = routeArea(distance)
  if (area.kind === 'lake') return [6.5, 75]
  if (area.kind === 'bridge') return [-75, 75]
  if (area.kind === 'park') {
    const offset = (distance - area.start - 140) / 80
    if (Math.abs(offset) < 1) {
      const radius = Math.sqrt(1 - offset * offset) * 12
      return [20 - radius, 20 + radius]
    }
  }
}

export function roadColor(kind: AreaKind, daylight: boolean) {
  const colors: Record<AreaKind, [number, number, number]> = {
    forest: [.34, .43, .40], town: [.55, .51, .43], park: [.44, .51, .38],
    bridge: [.59, .40, .25], lake: [.36, .46, .49], woodland: [.32, .39, .34],
  }
  const brightness = daylight ? 1 : 0.48
  return colors[kind].map(channel => channel * brightness)
}
