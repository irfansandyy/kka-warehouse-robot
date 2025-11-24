export function RangeInput({ label, value, min, max, onChange, step = 1, hint }) {
  const handleMinChange = (e) => {
    const next = Number(e.target.value);
    onChange({ min: next, max: Math.max(next, value.max) });
  };
  const handleMaxChange = (e) => {
    const next = Number(e.target.value);
    onChange({ max: next, min: Math.min(next, value.min) });
  };
  return (
    <div className="input-group">
      <label className="label">{label}</label>
      <input type="number" value={value.min} step={step} min={min} max={max} onChange={handleMinChange} />
      <span>-</span>
      <input type="number" value={value.max} step={step} min={min} max={max} onChange={handleMaxChange} />
      {hint && <span className="input-hint">{hint}</span>}
    </div>
  );
}
