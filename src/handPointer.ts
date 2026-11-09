import { isVisiblePoint } from './bodyTracking.ts'
import type { BodyPoint } from './bodyTracking.ts'

export type Hand = 'left' | 'right'
export type HandPointer = { hand: Hand; x: number; y: number }

function pointerFor(pose: readonly BodyPoint[], hand: Hand): HandPointer | undefined {
  const wrist = pose[hand === 'left' ? 15 : 16]
  if (!isVisiblePoint(wrist)) return
  return {
    hand,
    x: Math.max(0, Math.min(1, (0.85 - wrist.x) / 0.7)),
    y: Math.max(0, Math.min(1, (wrist.y - 0.15) / 0.7)),
  }
}

export function getHandPointers(pose: readonly BodyPoint[]) {
  return (['left', 'right'] as const).flatMap(hand => {
    const pointer = pointerFor(pose, hand)
    return pointer ? [pointer] : []
  })
}

export function getHandPointer(pose: readonly BodyPoint[], previousHand?: Hand): HandPointer | undefined {
  const left = pose[15]
  const right = pose[16]
  let hand: Hand
  if (isVisiblePoint(left) && isVisiblePoint(right)) {
    hand = previousHand ?? (left.y < right.y ? 'left' : 'right')
    if (hand === 'left' && right.y < left.y - 0.12) hand = 'right'
    if (hand === 'right' && left.y < right.y - 0.12) hand = 'left'
  } else if (isVisiblePoint(left)) hand = 'left'
  else if (isVisiblePoint(right)) hand = 'right'
  else return undefined
  return pointerFor(pose, hand)
}

export function createDualDwellController<T>() {
  const controllers = { left: createDwellController<T>(), right: createDwellController<T>() }
  const fired = new Map<T, Set<Hand>>()
  return {
    update(entries: { pointer: HandPointer; target: T | undefined; enabled?: boolean }[], time: number) {
      for (const [target, owners] of fired) {
        for (const entry of entries) {
          if (entry.target === target) owners.add(entry.pointer.hand)
          else owners.delete(entry.pointer.hand)
        }
        if (owners.size === 0) fired.delete(target)
      }
      const progress = { left: 0, right: 0 }
      const clicks: T[] = []
      for (const hand of ['left', 'right'] as const) {
        const entry = entries.find(item => item.pointer.hand === hand)
        const result = controllers[hand].update(entry?.pointer, entry?.enabled === false ? undefined : entry?.target, time)
        progress[hand] = result.progress
        if (result.click !== undefined && !fired.has(result.click)) {
          fired.set(result.click, new Set(entries.filter(item => item.target === result.click).map(item => item.pointer.hand)))
          clicks.push(result.click)
        }
      }
      return { progress, clicks }
    },
  }
}

export function createDwellController<T>() {
  let activeTarget: T | undefined
  let firedTarget: T | undefined
  let anchor: HandPointer | undefined
  let start = 0
  let lastTime: number | undefined

  return {
    update(pointer: HandPointer | undefined, target: T | undefined, time: number): { progress: number; click?: T } {
      const gap = lastTime === undefined ? 0 : time - lastTime
      lastTime = time
      if (!pointer || target === undefined) {
        activeTarget = undefined
        if (pointer) firedTarget = undefined
        anchor = undefined
        return { progress: 0 }
      }
      if (target !== firedTarget) firedTarget = undefined
      if (target === firedTarget) return { progress: 1 }
      if (target !== activeTarget || !anchor || anchor.hand !== pointer.hand
        || Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) > 30 || gap > 250) {
        activeTarget = target
        anchor = pointer
        start = time
      }
      const progress = Math.min(1, (time - start) / 600)
      if (progress < 1) return { progress }
      firedTarget = target
      return { progress: 1, click: target }
    },
  }
}
