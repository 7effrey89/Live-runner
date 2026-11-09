import { getBodyPosition } from './bodyTracking.ts'
import type { BodyPoint, BodyPosition } from './bodyTracking.ts'
import { MAX_PLAYERS } from './multiplayer.ts'

type Track = {
  id: number; position: BodyPosition; lastSeen: number; enrolledAt: number; vx: number; vy: number
  poseIndex: number | undefined
}
type Candidate = { position: BodyPosition; since: number; lastSeen: number; samples: number }
export type TrackedPlayer = { id: number; poseIndex: number | undefined; lastSeen: number; enrolledAt: number }
export const PLAYER_JOIN_DURATION = 600

export function createPlayerRoster() {
  let tracks: Track[] = []
  let candidates: Candidate[] = []
  let locked = false
  let allowed = new Set<number>()
  const cost = (a: BodyPosition, b: BodyPosition, aspect: number) => Math.hypot((a.x - b.x) * aspect, (a.y - b.y) * .7)
    / Math.max(a.scale, b.scale) + Math.abs(Math.log(a.scale / b.scale)) * .7
  return {
    reset() { tracks = []; candidates = []; locked = false; allowed.clear() },
    lock(time: number, ids?: readonly number[]) {
      allowed = new Set(ids ?? tracks.filter(track => track.poseIndex !== undefined && time - track.lastSeen < 400).map(track => track.id))
      locked = true
      candidates = []
      return [...allowed].sort((a, b) => a - b)
    },
    unlock() { locked = false; candidates = [] },
    update(poses: readonly (readonly BodyPoint[])[], time: number, aspect = 4 / 3): TrackedPlayer[] {
      const detections = poses.flatMap((pose, index) => {
        const position = getBodyPosition(pose, aspect)
        return position ? [{ index, position }] : []
      })
      const active = tracks.filter(track => !locked || allowed.has(track.id))
      const costs = active.map(track => detections.map(detection => {
        const age = time - track.lastSeen
        const dt = Math.min(200, age) / 1000
        const prediction = { ...track.position, x: track.position.x + track.vx * dt, y: track.position.y + track.vy * dt }
        const value = cost(age < 400 ? prediction : track.position, detection.position, aspect)
        return value < (age < 400 ? .95 : .65) ? value : Infinity
      }))
      // Globally match up to four people, never relying on MediaPipe's result order.
      let best = Infinity
      let assignment: number[] = []
      const search = (index: number, used: Set<number>, matches: number[], total: number) => {
        if (index === active.length) {
          if (total < best) { best = total; assignment = [...matches] }
          return
        }
        search(index + 1, used, [...matches, -1], total + 1.1)
        detections.forEach((_, detection) => {
          if (used.has(detection) || !Number.isFinite(costs[index][detection])) return
          used.add(detection)
          search(index + 1, used, [...matches, detection], total + costs[index][detection])
          used.delete(detection)
        })
      }
      search(0, new Set(), [], 0)
      const used = new Set<number>()
      active.forEach((track, index) => {
        track.poseIndex = undefined
        const match = assignment[index]
        if (match < 0 || match === undefined) return
        // Freeze ambiguous overlaps instead of arbitrarily swapping controllers.
        const rivals = costs.filter((_, other) => other !== index).map(row => row[match])
        const alternatives = costs[index].filter((_, detection) => detection !== match)
        if ([...rivals, ...alternatives].some(value => Math.abs(value - costs[index][match]) < .12)) return
        used.add(match)
        const detection = detections[match]
        const dt = (time - track.lastSeen) / 1000
        if (dt > 0 && dt < .4) {
          track.vx = .5 * track.vx + .5 * (detection.position.x - track.position.x) / dt
          track.vy = .5 * track.vy + .5 * (detection.position.y - track.position.y) / dt
        } else { track.vx = 0; track.vy = 0 }
        track.position = detection.position
        track.lastSeen = time
        track.poseIndex = detection.index
      })
      if (!locked) {
        tracks = tracks.filter(track => time - track.lastSeen < 2500)
        const remaining = detections.filter((_, index) => !used.has(index)).sort((a, b) => b.position.x - a.position.x)
        const next: Candidate[] = []
        for (const detection of remaining) {
          if (tracks.some(track => cost(track.position, detection.position, aspect) < .8)) continue
          const prior = candidates.find(candidate => time - candidate.lastSeen < 200 && cost(candidate.position, detection.position, aspect) < .18)
          const candidate = prior ? { ...prior, position: detection.position, lastSeen: time, samples: prior.samples + 1 }
            : { position: detection.position, since: time, lastSeen: time, samples: 1 }
          if (prior) candidates = candidates.filter(value => value !== prior)
          if (time - candidate.since >= PLAYER_JOIN_DURATION && candidate.samples >= 8 && tracks.length < MAX_PLAYERS) {
            const id = [0, 1, 2, 3].find(value => !tracks.some(track => track.id === value))!
            tracks.push({ id, position: detection.position, lastSeen: time, enrolledAt: time, vx: 0, vy: 0, poseIndex: detection.index })
          } else next.push(candidate)
        }
        candidates = next
      }
      return tracks.filter(track => !locked || allowed.has(track.id)).map(track => ({ id: track.id, poseIndex: track.poseIndex, lastSeen: track.lastSeen, enrolledAt: track.enrolledAt })).sort((a, b) => a.id - b.id)
    },
  }
}
