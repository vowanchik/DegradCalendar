import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, X } from 'lucide-react';
import { MonthCalendar } from './Calendar';
import { dateKey, defaultZone, formatDate, formatTime } from './time';
import type { WidgetState } from './types';

export function Widget() {
  const [state, setState] = useState<WidgetState>({
    events: [],
    zone: defaultZone,
    theme: 'forest',
    connected: false,
  });
  const [day, setDay] = useState('');
  useEffect(() => {
    const bridge = window.partyupWidget!;
    void bridge.getState().then(setState);
    return bridge.onState(setState);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.body.classList.add('widget-body');
  }, [state.theme]);
  const events = state.events.filter(
    (e) => !e.cancelled && e.my_status !== 'declined' && Date.parse(e.ends_at) > Date.now(),
  );
  const selected = events.filter((e) => dateKey(e.starts_at, state.zone) === day);
  function select(value: string) {
    setDay(value);
    const matches = events.filter((e) => dateKey(e.starts_at, state.zone) === value);
    if (matches.length === 1) window.partyupWidget!.openEvent(matches[0].id);
  }
  return (
    <div className="desktop-widget">
      <header className="widget-heading">
        <CalendarDays size={19} />
        <strong>Календарь PartyUp</strong>
        <button
          className="icon-button"
          aria-label="Скрыть виджет"
          onClick={() => window.partyupWidget!.hide()}
        >
          <X size={17} />
        </button>
      </header>
      <MonthCalendar events={events} zone={state.zone} selected={day} onSelect={select} />
      <div className="widget-events">
        {!state.connected && <p className="muted">Нет связи · показаны последние встречи</p>}
        {day ? (
          <>
            <h3>{formatDate(day + 'T12:00Z', 'UTC')}</h3>
            {selected.length ? (
              selected.map((e) => (
                <button
                  className="widget-event"
                  key={e.id}
                  onClick={() => window.partyupWidget!.openEvent(e.id)}
                >
                  <time>{formatTime(e.starts_at, state.zone)}</time>
                  <span>
                    <strong>{e.title}</strong>
                    <small>{e.my_status === 'pending' ? 'Ответить на приглашение' : e.game}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <p className="muted">На этот день встреч нет</p>
            )}
          </>
        ) : (
          <p className="muted">Выберите выделенную дату, чтобы открыть событие.</p>
        )}
      </div>
    </div>
  );
}
