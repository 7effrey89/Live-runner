import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { AMBIENT_SOUNDS, SOUND_DURATIONS, SYNTH_EFFECTS, synthesizeAbilitySound } from '../src/abilityAudio.ts'
import { createInvincibilityEffect, invincibilityGlow } from '../src/invincibility.ts'

test('every original ability sound produces finite, non-silent, bounded audio with click-free ends', () => {
  const fingerprints = new Set<number>()
  for (const rate of [22050, 48000]) {
    for (const sound of [...SYNTH_EFFECTS, ...AMBIENT_SOUNDS]) {
      const samples = synthesizeAbilitySound(sound, rate)
      assert.equal(samples.length, Math.ceil(SOUND_DURATIONS[sound] * rate))
      let sum = 0
      let peak = 0
      for (const sample of samples) {
        assert.ok(Number.isFinite(sample))
        peak = Math.max(peak, Math.abs(sample))
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / samples.length)
      assert.ok(rms > .005 && rms < .4, `${sound}: rms ${rms}`)
      assert.ok(peak < .95)
      assert.equal(samples[0], 0)
      assert.ok(Math.abs(samples[samples.length - 1]) < .002)
      if (rate === 48000) fingerprints.add(Math.round(sum * 1e5))
    }
  }
  assert.equal(fingerprints.size, SYNTH_EFFECTS.length + AMBIENT_SOUNDS.length)
  for (const rate of [NaN, Infinity, 0, 4000, 192001]) assert.throws(() => synthesizeAbilitySound('sword', rate), RangeError)
})

test('invincibility has slow bounded shimmer and a steady reduced-motion appearance', () => {
  const hues = new Set<number>()
  for (let time = 0; time <= 10; time += .01) {
    const glow = invincibilityGlow(time)
    assert.ok(glow.hue >= 0 && glow.hue < 1)
    assert.ok(glow.intensity >= .7 && glow.intensity <= .951)
    hues.add(Math.floor(glow.hue * 10))
    assert.deepEqual(invincibilityGlow(time, true), { hue: .13, intensity: .7 })
  }
  assert.equal(hues.size, 10)
})

test('invincibility restores original material colors and glow without changing opacity or another runner', () => {
  const original = new THREE.MeshStandardMaterial({ color: '#8276ad', emissive: '#102030', emissiveIntensity: .12, transparent: true, opacity: .8 })
  const geometry = new THREE.BoxGeometry()
  const model = new THREE.Group()
  const other = new THREE.Mesh(geometry, original.clone())
  model.add(new THREE.Mesh(geometry, original))
  const originalColor = original.color.clone()
  const originalEmissive = original.emissive.clone()
  const effect = createInvincibilityEffect(model)
  effect(true, 0)
  const firstHue = original.color.getHex()
  effect(true, 1)
  assert.notEqual(original.color.getHex(), firstHue)
  assert.ok(original.emissiveIntensity >= .7)
  assert.equal(original.opacity, .8)
  assert.ok(other.material.color.equals(originalColor))
  effect(true, 2, true)
  const reducedColor = original.color.clone()
  effect(true, 5, true)
  assert.ok(original.color.equals(reducedColor))
  effect(false, 10)
  assert.ok(original.color.equals(originalColor))
  assert.ok(original.emissive.equals(originalEmissive))
  assert.equal(original.emissiveIntensity, .12)
  assert.equal(original.opacity, .8)
  geometry.dispose()
  original.dispose()
  other.material.dispose()
})

test('invincibility snapshots the loaded skin appearance on each activation, not during model construction', () => {
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshPhongMaterial({ color: '#cccccc' })
  const model = new THREE.Mesh(geometry, material)
  const effect = createInvincibilityEffect(model)
  for (const [color, emissive, intensity] of [['#ffffff', '#112233', .2], ['#3478ab', '#203040', .3]] as const) {
    material.color.set(color)
    material.emissive.set(emissive)
    material.emissiveIntensity = intensity
    effect(false, 0)
    assert.equal(material.color.getHexString(), color.slice(1))
    effect(true, 1)
    effect(true, 2)
    effect(false, 10)
    assert.equal(material.color.getHexString(), color.slice(1))
    assert.equal(material.emissive.getHexString(), emissive.slice(1))
    assert.equal(material.emissiveIntensity, intensity)
  }
  geometry.dispose()
  material.dispose()
})
