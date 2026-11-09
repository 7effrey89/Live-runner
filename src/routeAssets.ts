export const ROUTE_ASSETS = [
  'town/wall-wood-door', 'town/wall-wood-window-shutters', 'town/roof-point',
  'town/chimney', 'town/stall-red', 'town/stall-green', 'town/stall-bench', 'town/lantern',
  'town/fountain-round', 'town/hedge', 'town/tree-high-round', 'town/windmill',
  'town/cart', 'town/planks', 'town/pillar-wood',
  'mini-forest/tree', 'mini-forest/tree-high', 'mini-forest/plant',
  'mini-forest/rocks-low', 'mini-forest/tent', 'mini-forest/building-platform',
  'mini-forest/building-structure', 'mini-forest/building-roof', 'mini-forest/bridge', 'mini-forest/fence',
] as const
export type RouteAsset = typeof ROUTE_ASSETS[number]
