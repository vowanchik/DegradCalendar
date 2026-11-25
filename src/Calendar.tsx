import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dateKey } from './time';
import type { GameEvent } from './types';
export function MonthCalendar({
  events,
  zone,
  selected,
  onSelect,
}: {
  events: GameEvent[];
  zone: string;
  selected: string;
  onSelect(day: string): void;
}) {
  const [month, setMonth] = useState(() => new Date(dateKey(new Date(), zone) + 'T12:00:00Z'));
  useEffect(() => {
    if (selected) setMonth(new Date(selected + 'T12:00:00Z'));
  }, [selected]);
  const y = month.getUTCFullYear(),
    m = month.getUTCMonth();
  const offset = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(),
    today = dateKey(new Date(), zone);
  return (
    <div className="month-calendar">
      <div className="month-header">
        <strong>
          {new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
            .format(month)
            .replace(' г.', '')}
        </strong>
        <div>
          <button
            aria-label="Предыдущий месяц"
            className="icon-button"
            onClick={() => setMonth(new Date(Date.UTC(y, m - 1, 1)))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="Следующий месяц"
            className="icon-button"
            onClick={() => setMonth(new Date(Date.UTC(y, m + 1, 1)))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="month-grid">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
          <span className="weekday" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={'blank' + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
          const has = events.some(
            (e) => !e.cancelled && e.my_status !== 'declined' && dateKey(e.starts_at, zone) === key,
          );
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={`${key === selected ? 'selected' : ''} ${key === today ? 'today' : ''} ${has ? 'has-event' : ''}`}
              aria-label={`${i + 1} ${new Intl.DateTimeFormat('ru', { month: 'long', timeZone: 'UTC' }).format(month)}${has ? ', есть встречи' : ''}`}
              aria-pressed={key === selected}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <button
        className="text-button calendar-reset"
        onClick={() => {
          setMonth(new Date(today + 'T12:00Z'));
          onSelect(today);
        }}
      >
        Сегодня
      </button>
    </div>
  );
}
