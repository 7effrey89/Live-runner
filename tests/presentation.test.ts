import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MUSIC_DURATION, MUSIC_MELODY, SOUND_FILES, validateVolume } from '../src/gameAudio.ts'
import { sceneryZ } from '../src/scenery.ts'
import { birdMotion, GROUND_ANIMALS, groundAnimalMotion } from '../src/wildlifeMotion.ts'
import { roadColor, routeArea, routeCenter, routeElevation, routeHeading, routePoint, ROUTE_LAP_LENGTH, waterSpan } from '../src/route.ts'
import { ROUTE_ASSETS } from '../src/routeAssets.ts'
import { MAX_RUN_SPEED, advanceGame, laneX, newGame } from '../src/gameLogic.ts'
import { requestJump } from '../src/gameLogic.ts'
import type { Item } from '../src/gameLogic.ts'
import { jumpTiming } from '../src/difficulty.ts'
import { GUIDE_TIMING_MARGIN, jumpNow, jumpZone } from '../src/jumpGuidance.ts'

test('scenery loops continuously at the boundary and repeats after 216 meters', () => {
  for (let row = 0; row < 18; row++) {
    for (const distance of [0, 0.01, 12, 215.99, 216, 1000]) {
      const z = sceneryZ(row, distance)
      assert.ok(z > -208.01 && z <= 8)
      assert.ok(Math.abs(z - sceneryZ(row, distance + 216)) < 1e-9)
    }
    assert.ok(Math.abs(sceneryZ(row, 1.05) - sceneryZ(row, 1)) < 0.051)
  }
})

test('all wildlife species cross all three lanes in both directions and rest off-road between crossings', () => {
  assert.deepEqual(new Set(GROUND_ANIMALS.map(animal => animal.kind)), new Set(['frog', 'mouse', 'rabbit', 'deer']))
  assert.deepEqual(new Set(GROUND_ANIMALS.map(animal => animal.direction)), new Set([-1, 1]))
  GROUND_ANIMALS.forEach((animal, index) => {
    const at = (elapsed: number) => groundAnimalMotion(index, animal.period - animal.offset + elapsed)
    assert.ok(Math.abs(at(0).x + animal.direction * 12) < 1e-9)
    assert.ok(Math.abs(at(animal.duration - 0.001).x - animal.direction * 12) < 0.01)
    const visited = new Set<number>()
    for (let elapsed = 0; elapsed < animal.duration; elapsed += 1 / 60) {
      const motion = at(elapsed)
      assert.ok(motion.visible)
      for (const lane of [-2.5, 0, 2.5]) if (Math.abs(motion.x - lane) < 0.15) visited.add(lane)
      assert.ok(motion.hop >= -1e-9 && motion.hop <= 0.3)
      const next = at(elapsed + 1 / 60)
      assert.ok(Math.abs(next.x - motion.x) < 0.2)
      assert.ok(Math.abs(next.hop - motion.hop) < 0.08)
    }
    assert.equal(visited.size, 3)
    assert.equal(at(animal.duration + 0.01).visible, false)
  })
})

test('animal schedules repeat without needing gameplay distance or a running game', () => {
  GROUND_ANIMALS.forEach((animal, index) => {
    const time = animal.period - animal.offset + 0.2
    const first = groundAnimalMotion(index, time)
    const later = groundAnimalMotion(index, time + 0.2)
    const repeat = groundAnimalMotion(index, time + animal.period)
    assert.notEqual(first.x, later.x)
    assert.equal(repeat.cycle, first.cycle + 1)
    assert.equal(repeat.visible, first.visible)
    assert.ok(Math.abs(repeat.x - first.x) < 1e-9)
    assert.ok(Math.abs(repeat.hop - first.hop) < 1e-9)
  })
})

test('birds fly continuously above the runner, face their flight direction, and flap both ways', () => {
  for (let index = 0; index < 5; index++) {
    let minFlap = Infinity, maxFlap = -Infinity
    for (let time = 0; time < 45; time += 0.05) {
      const bird = birdMotion(index, time)
      const next = birdMotion(index, time + 0.001)
      assert.ok(bird.y > 3.5 && bird.y < 6.5)
      assert.ok(bird.z >= -66 && bird.z <= -18)
      assert.ok(Math.abs(next.x - bird.x) < 0.01)
      assert.ok(Math.abs(next.z - bird.z) < 0.01)
      const dx = next.x - bird.x, dz = next.z - bird.z
      const alignment = (dx * Math.cos(bird.heading) - dz * Math.sin(bird.heading)) / Math.hypot(dx, dz)
      assert.ok(alignment > 0.999)
      minFlap = Math.min(minFlap, bird.flap)
      maxFlap = Math.max(maxFlap, bird.flap)
    }
    assert.ok(minFlap < -0.5 && maxFlap > 0.8)
    const first = birdMotion(index, 0)
    const repeat = birdMotion(index, Math.PI * 2 / (0.16 + index * 0.012))
    for (const coordinate of ['x', 'y', 'z'] as const) assert.ok(Math.abs(first[coordinate] - repeat[coordinate]) < 1e-9)
  }
})

test('volume accepts independent channel levels including mute and rejects invalid input', () => {
  assert.equal(validateVolume(0), 0)
  assert.equal(validateVolume(0.25), 0.25)
  assert.equal(validateVolume(1), 1)
  for (const value of [-0.01, 1.01, NaN, Infinity]) assert.throws(() => validateVolume(value), RangeError)
})

test('original music covers an eight-second loop with playable notes', () => {
  assert.equal(MUSIC_DURATION, 8)
  assert.equal(MUSIC_MELODY.length, 16)
  assert.ok(MUSIC_MELODY.every(note => note >= 60 && note <= 84))
})

test('every sound file and both imported asset licenses are bundled locally', () => {
  for (const file of Object.values(SOUND_FILES)) assert.ok(existsSync(new URL(`../public/assets/kenney/sounds/${file}`, import.meta.url)))
  for (const folder of ['sounds', 'environment']) assert.ok(existsSync(new URL(`../public/assets/kenney/${folder}/License.txt`, import.meta.url)))
})

test('regions are continuous, deterministic, varied and include a long lake after each bridge', () => {
  const orders = new Set<string>()
  const lakeLengths = new Set<number>()
  for (let lap = 0; lap < 48; lap++) {
    let distance = lap * ROUTE_LAP_LENGTH
    const kinds = []
    for (let index = 0; index < 6; index++) {
      const area = routeArea(distance)
      assert.equal(area.id, lap * 6 + index)
      assert.equal(area.start, distance)
      assert.deepEqual(area, routeArea(distance + .1))
      assert.ok(area.end > area.start)
      assert.equal(routeArea(area.end - .001).id, area.id)
      assert.equal(routeArea(area.end).id, area.id + 1)
      if (area.kind === 'bridge') assert.equal(routeArea(area.end).kind, 'lake')
      if (area.kind === 'lake') {
        assert.ok((area.end - area.start) / MAX_RUN_SPEED > 23)
        lakeLengths.add(area.end - area.start)
        assert.deepEqual(waterSpan(area.start + 1), [6.5, 75])
        assert.deepEqual(waterSpan(area.end - 1), [6.5, 75])
      }
      kinds.push(area.kind)
      distance = area.end
    }
    assert.equal(distance, (lap + 1) * ROUTE_LAP_LENGTH)
    assert.equal(new Set(kinds).size, 6)
    orders.add(kinds.join(','))
  }
  assert.equal(orders.size, 3)
  assert.ok(lakeLengths.size > 10)
})

test('curves keep lane spacing and actor placement consistent without abrupt turns', () => {
  assert.ok(Math.abs(routeHeading(0)) === 0)
  assert.equal(routeCenter(0), 0)
  for (let distance = 0; distance < 6000; distance += 7) {
    assert.ok(Math.abs(routeHeading(distance)) < Math.atan(.09))
    assert.ok(Math.abs(routeHeading(distance + .01) - routeHeading(distance)) < .00001)
    for (const z of [0, -.5, -15, -120, 9]) {
      const center = routePoint(distance, z)
      for (const lane of [-1, 1] as const) {
        const point = routePoint(distance, z, laneX(lane))
        assert.ok(Math.abs(Math.hypot(point.x - center.x, point.z - center.z) - 2.5) < 1e-9)
        assert.equal(point.heading, center.heading)
        assert.equal(point.y, routeElevation(distance - z))
      }
    }
    assert.equal(routePoint(distance, 0).x, 0)
    assert.equal(routePoint(distance, 0).z, 0)
  }
})

test('bridge elevation meets adjoining roads smoothly and water stays beside ordinary lanes', () => {
  for (let distance = 0; distance < ROUTE_LAP_LENGTH; distance += 1) {
    const area = routeArea(distance)
    if (area.kind === 'bridge') {
      assert.equal(routeElevation(area.start), 0)
      assert.equal(routeElevation(area.end), 0)
      assert.equal(routeElevation(area.start + 60), .35)
      assert.ok(routeElevation(area.start + .001) < 1e-8)
      assert.ok(routeElevation(area.end - .001) < 1e-8)
      assert.deepEqual(waterSpan(distance), [-75, 75])
    } else {
      assert.equal(routeElevation(distance), 0)
      const water = waterSpan(distance)
      if (water) assert.ok(water[0] > 4)
    }
    assert.ok(Math.abs(routeElevation(distance + .01) - routeElevation(distance)) < .00023)
    if (area.kind === 'park') {
      assert.equal(waterSpan(area.start + 60), undefined)
      assert.deepEqual(waterSpan(area.start + 140), [8, 32])
      assert.equal(waterSpan(area.start + 220), undefined)
    }
  }
})

test('all areas keep their road palette while lighting changes brightness', () => {
  for (const kind of ['forest', 'town', 'park', 'bridge', 'lake', 'woodland'] as const) {
    const day = roadColor(kind, true)
    const night = roadColor(kind, false)
    assert.equal(day.length, 3)
    day.forEach((value, index) => {
      assert.ok(value > 0 && value < 1)
      assert.equal(night[index], value * .48)
    })
  }
})

test('hazard outcomes do not depend on the scenic region or curved rendering coordinates', () => {
  for (const distance of [0, 350, 750, 990, 1040, 1100, 1800, 2500]) {
    const game = newGame('free-run', 2)
    game.phase = 'running'
    game.distance = distance
    game.nextSpawn = 999999
    game.items = [{ id: 0, lane: 0, kind: 'barrier', z: -.5, hit: false }]
    advanceGame(game, .01)
    assert.equal(game.recovery, 1.6)
    assert.equal(game.lastPenalty, Math.min(100, Math.floor(game.distance)))
    assert.ok(game.items[0].fall)
  }
})

test('route models, their original CC0 licenses, and referenced palette textures are bundled', () => {
  for (const asset of ROUTE_ASSETS) {
    const file = new URL(`../public/assets/kenney/${asset}.glb`, import.meta.url)
    const data = readFileSync(file)
    assert.equal(data.toString('ascii', 0, 4), 'glTF')
    const definition = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)).trim())
    for (const image of definition.images ?? []) {
      if (image.uri) assert.ok(existsSync(new URL(image.uri, file)), `${asset}: ${image.uri}`)
    }
  }
  for (const folder of ['town', 'mini-forest']) {
    const license = readFileSync(new URL(`../public/assets/kenney/${folder}/License.txt`, import.meta.url), 'utf8')
    assert.match(license, /CC0/)
  }
})

test('assisted jump zones sit before barriers and widen with speed and lower difficulty', () => {
  const item: Item = { id: 1, kind: 'barrier', lane: 0, z: -20, hit: false }
  for (const speed of [15, 23, 31]) {
    let previousWidth = Infinity
    for (const difficulty of [0, .5, 1, 1.5, 2]) {
      const timing = jumpTiming(difficulty)
      const zone = jumpZone(item, speed, difficulty)!
      assert.ok(zone.near > item.z + .9)
      assert.ok(zone.far > zone.near)
      assert.ok(Math.abs((zone.far - zone.near) / speed - (timing.end - timing.start - 2 * GUIDE_TIMING_MARGIN)) < 1e-9)
      assert.ok(zone.far - zone.near < previousWidth)
      previousWidth = zone.far - zone.near
    }
  }
  const slow = jumpZone(item, 15, 1)!
  const fast = jumpZone(item, 31, 1)!
  assert.ok(fast.far - fast.near > slow.far - slow.near)
})

test('the jump-now cue only recommends grounded, available jumps in the correct lane', () => {
  const game = newGame()
  game.phase = 'running'
  const item: Item = { id: 1, kind: 'barrier', lane: 0, z: -5, hit: false }
  const timing = jumpTiming(game.difficulty)
  item.z = -.9 - game.speed * (timing.start + timing.end) / 2
  game.items = [item]
  assert.equal(jumpNow(game), true)
  game.lane = 1
  assert.equal(jumpNow(game), false)
  game.lane = 0
  for (const key of ['jump', 'slide', 'recovery'] as const) {
    game[key] = .1
    assert.equal(jumpNow(game), false)
    game[key] = 0
  }
  game.phase = 'ready'
  assert.equal(jumpNow(game), false)
  game.phase = 'over'
  assert.equal(jumpNow(game), false)
  game.phase = 'running'
  item.z = -40
  assert.equal(jumpNow(game), false)
})

test('guidance never labels non-jumpable, already hit, falling, contacted, or passed obstacles', () => {
  const item: Item = { id: 1, kind: 'barrier', lane: 0, z: -10, hit: false }
  for (const kind of ['block', 'overhead', 'coin'] as const) assert.equal(jumpZone({ ...item, kind }, 15, 1), undefined)
  assert.equal(jumpZone({ ...item, hit: true }, 15, 1), undefined)
  assert.equal(jumpZone({ ...item, jumpContactAt: 1 }, 15, 1), undefined)
  assert.equal(jumpZone({ ...item, fall: { age: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0 } }, 15, 1), undefined)
  for (const z of [-.9, 0, 4]) assert.equal(jumpZone({ ...item, z }, 15, 1), undefined)
})

test('jumping at either recommended zone edge clears real barriers at every speed and difficulty', () => {
  for (const distance of [0, 1440, 2880, 5000]) {
    for (const difficulty of [0, .5, 1, 1.5, 2]) {
      for (const delta of [1 / 60, 1 / 30, .05]) {
        for (const edge of ['near', 'far'] as const) {
          const game = newGame('survival', difficulty)
          game.phase = 'running'
          game.distance = distance
          advanceGame(game, 0)
          game.nextSpawn = 10000
          const item: Item = { id: 1, kind: 'barrier', lane: 0, z: -30, hit: false }
          const zone = jumpZone(item, game.speed, difficulty)!
          item.z -= zone[edge]
          game.items = [item]
          assert.equal(jumpNow(game), true)
          requestJump(game)
          for (let frame = 0; frame < 60 && !item.hit; frame++) advanceGame(game, delta)
          assert.equal(item.hit, true, `${distance}, ${difficulty}, ${delta}, ${edge}`)
          assert.equal(item.fall, undefined)
          assert.equal(game.lives, 5)
        }
      }
    }
  }
})
