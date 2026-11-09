import { useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'
const getSnapshot = () => window.matchMedia(query).matches
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export const useReducedMotion = () => useSyncExternalStore(subscribe, getSnapshot, () => false)
