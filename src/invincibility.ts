import * as THREE from 'three'

export function invincibilityGlow(time: number, reducedMotion = false) {
  return {
    hue: reducedMotion ? .13 : (time / 3 % 1 + 1) % 1,
    intensity: reducedMotion ? .7 : .7 + .25 * (1 + Math.sin(time * Math.PI * 1.6)) / 2,
  }
}

export function createInvincibilityEffect(model: THREE.Object3D) {
  const states: { material: THREE.MeshPhongMaterial | THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color; intensity: number }[] = []
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshStandardMaterial) {
        states.push({ material, color: material.color.clone(), emissive: material.emissive.clone(), intensity: material.emissiveIntensity })
      }
    }
  })
  let active = false
  return (enabled: boolean, time: number, reducedMotion = false) => {
    if (!enabled && !active) return
    const starting = enabled && !active
    active = enabled
    const glow = invincibilityGlow(time, reducedMotion)
    for (const state of states) {
      if (enabled) {
        if (starting) {
          state.color.copy(state.material.color)
          state.emissive.copy(state.material.emissive)
          state.intensity = state.material.emissiveIntensity
        }
        state.material.color.setHSL(glow.hue, .65, .65)
        state.material.emissive.setHSL(glow.hue, .8, .4)
        state.material.emissiveIntensity = glow.intensity
      } else {
        state.material.color.copy(state.color)
        state.material.emissive.copy(state.emissive)
        state.material.emissiveIntensity = state.intensity
      }
    }
  }
}
