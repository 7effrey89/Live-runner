import { jumpTiming } from './difficulty'

export function DifficultyControl({ id, value, onChange }: { id: string; value: number; onChange: (value: number) => void }) {
  const timing = jumpTiming(value)
  return <div className="difficulty-control">
    <div className="volume-label"><label htmlFor={id}>Jump difficulty</label><output htmlFor={id}>{timing.label}</output></div>
    <div className="volume-input">
      <button data-hand-action aria-label="Easier jump timing" disabled={value === 0} onClick={() => onChange(Math.max(0, Math.round((value - .1) * 10) / 10))}>−</button>
      <input id={id} type="range" min="0" max="2" step="0.1" value={value}
        aria-valuetext={`${timing.label}, ${Math.round(timing.allowance * 1000)} milliseconds extra early and late allowance`}
        aria-describedby={`${id}-timing`} onChange={event => onChange(Number(event.target.value))} />
      <button data-hand-action aria-label="Harder jump timing" disabled={value === 2} onClick={() => onChange(Math.min(2, Math.round((value + .1) * 10) / 10))}>+</button>
    </div>
    <div className="difficulty-presets">
      {(['Easy', 'Normal', 'Hard'] as const).map((label, preset) => <button key={label} data-hand-action aria-pressed={value === preset} onClick={() => onChange(preset)}>{label}</button>)}
    </div>
    <p id={`${id}-timing`} className="difficulty-timing">Extra early / late allowance: <strong>{Math.round(timing.allowance * 1000)} ms</strong><br />Jump timing window: {Math.round(timing.window * 1000)} ms. Animation stays snappy.</p>
  </div>
}
