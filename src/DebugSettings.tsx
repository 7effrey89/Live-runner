import { createSpawnOverrides } from './debugMode'
import type { SpawnOverrides } from './debugMode'
import { ABILITY_LABELS, MYSTERY_REWARDS, SABER_COLORS } from './powerUps'

function SpawnChoices<T extends string | number>({ label, options, selected, onChange }: {
  label: string; options: readonly { value: T; label: string }[]; selected: readonly T[]; onChange: (selected: T[]) => void
}) {
  return <fieldset className="debug-choices">
    <legend>{label}</legend>
    <div>{options.map(option => {
      const active = selected.includes(option.value)
      return <button key={option.value} type="button" data-hand-action aria-pressed={active} disabled={active && selected.length === 1}
        onClick={() => onChange(active ? selected.filter(value => value !== option.value) : [...selected, option.value])}>{option.label}</button>
    })}</div>
  </fieldset>
}

export function DebugSettings({ enabled, onEnabledChange, value, onChange }: {
  enabled: boolean; onEnabledChange: (enabled: boolean) => void; value: SpawnOverrides; onChange: (value: SpawnOverrides) => void
}) {
  return <div className="debug-settings">
    <button className="assisted-toggle" type="button" data-hand-action aria-pressed={enabled} aria-expanded={enabled}
      aria-controls="debug-spawn-controls" onClick={() => onEnabledChange(!enabled)}>Debug mode <span>{enabled ? 'ON' : 'OFF'}</span></button>
    {enabled && <div id="debug-spawn-controls" className="debug-spawn-controls">
      <p className="difficulty-timing">New waves only. One selected element per wave; keep at least one choice per group.</p>
      <SpawnChoices label="Lanes" options={[{ value: -1, label: 'Left' }, { value: 0, label: 'Center' }, { value: 1, label: 'Right' }]}
        selected={value.lanes} onChange={lanes => onChange({ ...value, lanes })} />
      <SpawnChoices label="Lane elements" options={[
        { value: 'barrier', label: 'Low barrier' }, { value: 'overhead', label: 'Overhead' }, { value: 'block', label: 'Tall block' },
        { value: 'coin', label: 'Coin' }, { value: 'mystery', label: 'Mystery box' },
      ]} selected={value.kinds} onChange={kinds => onChange({ ...value, kinds })} />
      {value.kinds.includes('mystery') && <>
        <SpawnChoices label="Mystery-box rewards" options={MYSTERY_REWARDS.map(reward => ({
          value: reward, label: reward === 'bonus' ? 'Life / coin' : ABILITY_LABELS[reward],
        }))} selected={value.rewards} onChange={rewards => onChange({ ...value, rewards })} />
        {value.rewards.includes('sword') && <SpawnChoices label="Sword colors" options={SABER_COLORS.map(color => ({
          value: color, label: color[0].toUpperCase() + color.slice(1),
        }))} selected={value.saberColors} onChange={saberColors => onChange({ ...value, saberColors })} />}
      </>}
      <button className="debug-reset" type="button" data-hand-action onClick={() => onChange(createSpawnOverrides())}>Reset spawn choices</button>
    </div>}
  </div>
}
