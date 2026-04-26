import { useState } from 'react';

export default function ChipInput({ value = [], onChange, placeholder = 'Add item...' }) {
  const [draft, setDraft] = useState('');

  function addChip() {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) { setDraft(''); return; }
    onChange([...value, v]);
    setDraft('');
  }

  function removeChip(idx) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="chip-input">
      <div className="chips">
        {value.map((chip, i) => (
          <span className="chip" key={i}>
            {chip}
            <button type="button" onClick={() => removeChip(i)} aria-label={`Remove ${chip}`}>×</button>
          </span>
        ))}
      </div>
      <div className="chip-input-row">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } }}
          placeholder={placeholder}
        />
        <button type="button" onClick={addChip}>Add</button>
      </div>
    </div>
  );
}
