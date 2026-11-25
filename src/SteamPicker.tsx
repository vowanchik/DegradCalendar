import { useEffect, useRef, useState } from 'react';
import { api } from './api';

type SteamGame = { id: number; name: string };
export const steamImage = (id: number, file = 'library_hero.jpg') =>
  `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/${file}`;

export function SteamPicker({ onChange }: { onChange(game: string, id: number | null): void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SteamGame | null>(null);
  const [items, setItems] = useState<SteamGame[]>([]);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setActive(-1);
    setMessage('');
    if (query.trim().length < 2 || selected) return;
    setMessage('Ищем в Steam…');
    const timer = setTimeout(() => {
      void api<SteamGame[]>(`/api/steam/search?q=${encodeURIComponent(query.trim().slice(0, 100))}`)
        .then((result) => {
          if (cancelled) return;
          setItems(result);
          setMessage(result.length ? '' : 'Ничего не найдено. Можно оставить своё название.');
        })
        .catch((error: unknown) => {
          if (!cancelled) setMessage(error instanceof Error ? error.message : 'Steam недоступен');
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected]);
  function choose(item: SteamGame) {
    setQuery(item.name);
    setSelected(item);
    setOpen(false);
    onChange(item.name, item.id);
  }
  return (
    <div
      className="steam-picker"
      ref={wrapper}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor="game-search">Игра</label>
      <input
        id="game-search"
        required
        minLength={2}
        maxLength={200}
        autoFocus
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !selected}
        aria-controls="steam-results"
        aria-activedescendant={active >= 0 ? `steam-${items[active]?.id}` : undefined}
        placeholder="Найти в Steam или ввести название"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(null);
          setOpen(true);
          onChange(event.target.value, null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
          if (event.key === 'ArrowDown' && items.length) {
            event.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % items.length);
          }
          if (event.key === 'ArrowUp' && items.length) {
            event.preventDefault();
            setActive((i) => (i <= 0 ? items.length : i) - 1);
          }
          if (event.key === 'Enter' && open && active >= 0 && items[active]) {
            event.preventDefault();
            choose(items[active]);
          }
        }}
      />
      {open && !selected && query.trim().length >= 2 && (
        <div className="steam-results" id="steam-results" role="listbox" aria-label="Игры Steam">
          {items.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={active === index}
              id={`steam-${item.id}`}
              key={item.id}
              onClick={() => choose(item)}
            >
              <span>{item.name}</span>
              <small>Steam</small>
            </button>
          ))}
          {message && <p role="status">{message}</p>}
        </div>
      )}
      <p className="field-hint">
        {selected
          ? 'Игра Steam выбрана — обложка появится в карточке.'
          : 'Выберите результат для обложки Steam. Для других игр достаточно названия.'}
      </p>
    </div>
  );
}
