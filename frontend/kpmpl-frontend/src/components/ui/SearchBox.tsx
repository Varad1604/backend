/** Search: a bottom rule only, no box, no icon. */
export function SearchBox({ id, value, onChange, placeholder = 'Search vehicle, gate entry or supplier', label }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; label: string }) {
  return (
    <div className="flex w-full items-end gap-3 sm:w-auto">
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" aria-label={label}
        placeholder={placeholder}
        className="h-10 w-full border-0 border-b border-field bg-transparent px-0 text-[16px] text-ink outline-none focus:border-b-2 focus:border-ink focus-visible:outline-none sm:w-[300px] [&::-webkit-search-cancel-button]:hidden" />
      {value && <button type="button" onClick={() => onChange('')} className="act min-h-10 shrink-0 text-[15px] sm:min-h-0 sm:pb-2.5" aria-label="Clear search">Clear</button>}
    </div>
  );
}
