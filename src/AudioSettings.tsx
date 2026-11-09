import type { useGameAudio } from './useGameAudio'

function Volume({ id, label, value, onChange }: {
  id: string; label: string; value: number; onChange: (value: number) => void
}) {
  return <div className="volume-control">
    <div className="volume-label"><label htmlFor={id}>{label}</label><output htmlFor={id}>{Math.round(value * 100)}%</output></div>
    <div className="volume-input">
      <button data-hand-action aria-label={`Decrease ${label.toLowerCase()}`} disabled={value === 0} onClick={() => onChange(Math.max(0, Math.round((value - 0.1) * 100) / 100))}>−</button>
      <input id={id} type="range" min="0" max="100" step="1" value={Math.round(value * 100)} onChange={event => onChange(Number(event.target.value) / 100)} />
      <button data-hand-action aria-label={`Increase ${label.toLowerCase()}`} disabled={value === 1} onClick={() => onChange(Math.min(1, Math.round((value + 0.1) * 100) / 100))}>+</button>
    </div>
  </div>
}

export function AudioSettings({ audio }: { audio: ReturnType<typeof useGameAudio> }) {
  return <section id="audio-controls" className="panel audio-panel" aria-label="Audio settings">
    <div className="panel-heading"><div><span className="section-number">03 / YOUR SOUND</span><h2>Set the mood<span>.</span></h2></div><span className="panel-icon" aria-hidden="true">♫</span></div>
    <Volume id="music-volume" label="Background music volume" value={audio.musicVolume} onChange={audio.setMusicVolume} />
    <Volume id="effects-volume" label="Sound effects volume" value={audio.effectsVolume} onChange={audio.setEffectsVolume} />
    <button className="camera-button" data-hand-action={audio.status === 'ready' ? true : undefined} disabled={audio.status === 'loading'} onClick={audio.status === 'ready' ? () => audio.playEffect('coin') : audio.unlock}>
      {audio.status === 'ready' ? 'TEST EFFECT' : audio.status === 'loading' ? 'LOADING SOUND' : audio.status === 'error' ? 'RETRY SOUND' : 'ENABLE SOUND'}
    </button>
    {audio.error ? <p className="audio-message" role="alert">{audio.error}</p> : <p className="audio-message" role="status">{audio.status === 'ready' ? 'Original ambient arcade music and Kenney effects. Set either volume to 0 to mute it.' : 'Sound starts after a mouse click or keypress. Camera gestures cannot unlock browser audio.'}</p>}
    <div className="tip"><span>↗</span><p><strong>Hands-free volume</strong>Hold your hand cursor over the − or + buttons to adjust either channel separately. Camera tracking stays active in this view.</p></div>
  </section>
}
