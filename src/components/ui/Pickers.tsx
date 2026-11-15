'use client';

export const COLOR_SWATCHES = [
  '#8b7cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e',
  '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444', '#ec4899',
  '#d946ef', '#a1a1aa', '#64748b', '#f5f5f4',
];

export const ICON_CHOICES = [
  '📔', '💡', '🚀', '📚', '✍️', '🗄️', '🏠', '🎬', '🎭', '🌌', '🪐', '🌙',
  '⭐', '🔥', '🌱', '🧠', '🎯', '🗺️', '⚔️', '🛡️', '🎵', '🎨', '📷', '💼',
  '🧪', '🔬', '💬', '📝', '📌', '🗂️', '🧭', '❤️', '👤', '👥', '🐉', '🏛️',
];

export function ColorPicker({ value, onChange, allowNone = true }: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button type="button" className={`swatch swatch--none ${value === null ? 'is-on' : ''}`} onClick={() => onChange(null)}
          aria-label="Sem cor" title="Sem cor" />
      )}
      {COLOR_SWATCHES.map((c) => (
        <button type="button" key={c} className={`swatch ${value === c ? 'is-on' : ''}`} style={{ background: c }}
          onClick={() => onChange(c)} aria-label={`Cor ${c}`} title={c} />
      ))}
      <label className="swatch swatch--custom" title="Cor personalizada">
        <input type="color" value={value ?? '#8b7cf6'} onChange={(e) => onChange(e.target.value)} aria-label="Cor personalizada" />
        <span>+</span>
      </label>
    </div>
  );
}

export function IconPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="icon-picker">
      <div className="icon-grid">
        <button type="button" className={`icon-cell ${!value ? 'is-on' : ''}`} onClick={() => onChange(null)} title="Sem ícone">∅</button>
        {ICON_CHOICES.map((i) => (
          <button type="button" key={i} className={`icon-cell ${value === i ? 'is-on' : ''}`} onClick={() => onChange(i)}>{i}</button>
        ))}
      </div>
      <input
        className="input input--sm"
        placeholder="Ou digite/cole qualquer emoji ou até 2 letras"
        value={value && !ICON_CHOICES.includes(value) ? value : ''}
        maxLength={16}
        onChange={(e) => onChange(e.target.value.trim() || null)}
      />
    </div>
  );
}
