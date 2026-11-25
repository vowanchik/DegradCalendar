import { useCallback, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Gamepad2,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  LoaderCircle,
  CheckCircle2,
  Circle,
  Globe2,
  Monitor,
  Smartphone,
  AlertCircle,
} from 'lucide-react';
import {
  api,
  ApiError,
  clearToken,
  SessionChangedError,
  getSessionVersion,
  connectDesktop,
  loadToken,
  mobile,
  saveToken,
  serverUrl,
  setServerUrl,
} from './api';
import { enablePush, logoutPush, stopPush } from './integrations';
import { dateKey, defaultZone, formatDate, formatTime, zonedUtc } from './time';
import type { AppState, GameEvent, Message, Person } from './types';
import { MonthCalendar } from './Calendar';
import { Settings } from './Settings';
import { NotificationPopover } from './NotificationPopover';
import { loadPreferences, savePreferences, preferenceScope } from './preferences';
import type { DevicePreferences } from './types';

type View = 'calendar' | 'invitations' | 'friends' | 'settings';
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Не удалось выполнить действие';
const gameClass = (game: string) =>
  game.toLowerCase().includes('mine')
    ? 'craft'
    : game.toLowerCase().includes('counter')
      ? 'strike'
      : game.toLowerCase().includes('dota') || game.toLowerCase().includes('baldur')
        ? 'fantasy'
        : 'space';
function Avatar({ person, small = false }: { person: Person; small?: boolean }) {
  return (
    <span
      className={`avatar ${small ? 'small' : ''}`}
      style={{ '--avatar': person.color } as React.CSSProperties}
      title={person.name}
    >
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
function Logo() {
  return (
    <div className="brand">
      <img src="./assets/logo.svg" alt="" />
      <span>
        party<span className="brand-up">up</span>
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Busy() {
  return <LoaderCircle size={18} className="spin" />;
}
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function GameArt({ game }: { game: string }) {
  const kind = gameClass(game);
  return (
    <div className={`game-art ${kind}`} aria-hidden="true">
      <div className="art-orbit" />
      <div className="art-moon" />
      <svg viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice">
        <path
          d="M0 130 65 64l37 40 54-76 72 87 69-65 63 82v40H0z"
          fill="currentColor"
          opacity=".32"
        />
        <path
          d="M0 150v-27l65-23 52 21 72-48 48 50 58-24 65 42v30H0z"
          fill="currentColor"
          opacity=".45"
        />
        {kind === 'craft' ? (
          <g fill="currentColor">
            <path d="M126 102V69h34V43h44v27h28v60h-44v-28z" />
            <path d="M52 130V89h25V68h28v62z" />
            <path d="M264 138V84h28V60h23v78z" />
          </g>
        ) : (
          <g fill="currentColor">
            <path d="m206 70-11 28 6 25-9 20h12l8-18 8 18h13l-12-24 5-20-8-29z" />
            <circle cx="214" cy="60" r="11" />
            <path d="m226 80 35 16-3 7-39-10z" />
          </g>
        )}
      </svg>
      <span className="art-genre">
        {kind === 'craft'
          ? 'ОТКРЫТЫЙ МИР'
          : kind === 'strike'
            ? 'ТАКТИЧЕСКИЙ ШУТЕР'
            : kind === 'fantasy'
              ? 'ПРИКЛЮЧЕНИЕ'
              : 'КОМАНДНЫЙ КООП'}
      </span>
      <span className="art-game">{game}</span>
    </div>
  );
}

function TransportNotice({ address }: { address: string }) {
  if (!address.trim().toLowerCase().startsWith('http://')) return null;
  return (
    <div className="transport-notice" role="note">
      <AlertCircle size={17} />
      <span>
        Подключение без шифрования. Пароль, сообщения и токен входа передаются по HTTP. Используйте
        отдельный пароль для PartyUp.
      </span>
    </div>
  );
}

function Auth({ onLogin }: { onLogin(): Promise<void> }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [server, setServer] = useState(serverUrl()),
    [demoAvailable, setDemo] = useState(false);
  useEffect(() => {
    if (serverUrl())
      void api<{ demo: boolean }>('/api/health')
        .then((r) => setDemo(r.demo))
        .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>, demo = false) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setServerUrl(server);
      const form = new FormData(e.currentTarget);
      const result = await api<{ token: string }>(
        demo ? '/api/auth/demo' : register ? '/api/auth/register' : '/api/auth/login',
        { username: form.get('username'), password: form.get('password'), name: form.get('name') },
      );
      await saveToken(result.token);
      await onLogin();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <section className="auth-story">
        <Logo />
        <div className="auth-copy">
          <span className="eyebrow">
            <span className="tiny-star">✳</span> ХОРОШИЕ ВЕЧЕРА НЕ СЛУЧАЮТСЯ САМИ
          </span>
          <h1>
            Меньше «когда?».
            <br />
            Больше <em>«погнали!»</em>
          </h1>
          <p>
            Ваши друзья. Любимые игры.
            <br />
            Одно время, которое подходит всем.
          </p>
          <div className="auth-pills">
            <span>
              <CalendarDays size={16} /> Планируйте
            </span>
            <span>
              <Users size={16} /> Собирайтесь
            </span>
            <span>
              <Gamepad2 size={16} /> Играйте
            </span>
          </div>
        </div>
        <img
          className="auth-landscape"
          src="./assets/expedition.svg"
          alt="Два путешественника идут к светящемуся порталу в горах"
        />
        <div className="auth-footer">СВОЯ КОМАНДА. СВОИ ПРИКЛЮЧЕНИЯ.</div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <span className="section-kicker">ВАШ СЛЕДУЮЩИЙ ВЕЧЕР НАЧИНАЕТСЯ ЗДЕСЬ</span>
          <h2>{register ? 'Соберём вашу команду' : 'С возвращением 👋'}</h2>
          <p className="muted">
            {register
              ? 'Создайте аккаунт и позовите своих.'
              : 'Войдите, чтобы узнать, во что играем дальше.'}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                Как вас зовут
                <input
                  name="name"
                  placeholder="Например, Саша"
                  minLength={2}
                  maxLength={32}
                  autoComplete="nickname"
                  required
                />
              </label>
            )}
            <label>
              Логин
              <input
                name="username"
                placeholder="Ваш игровой ник"
                minLength={3}
                maxLength={32}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                placeholder="Не менее 8 символов"
                minLength={8}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <label className="server-field">
              Адрес общего сервера
              <input
                value={server}
                onChange={(e) => {
                  setServer(e.target.value);
                  setDemo(false);
                }}
                placeholder="http://192.168.1.50:3001"
                type="url"
                required
              />
              <span className="field-hint">
                HTTP или HTTPS. На всех устройствах должен быть указан один сервер.
              </span>
            </label>
            <TransportNotice address={server} />
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={17} />
                {error}
              </div>
            )}
            <button disabled={busy} className="button primary full">
              {busy ? <Busy /> : register ? 'Создать аккаунт' : 'Войти в PartyUp'}
            </button>
            {demoAvailable && (
              <button
                type="button"
                disabled={busy}
                className="button secondary full"
                onClick={(e) => {
                  const form = e.currentTarget.form!;
                  void submit(
                    { preventDefault() {}, currentTarget: form } as FormEvent<HTMLFormElement>,
                    true,
                  );
                }}
              >
                <Sparkles size={17} /> Посмотреть локальное демо
              </button>
            )}
          </form>
          <p className="auth-switch">
            {register ? 'Уже с нами?' : 'Ещё нет аккаунта?'}{' '}
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Войти' : 'Присоединиться'}
            </button>
          </p>
          <div className="auth-platforms">
            <Monitor size={16} />
            <span>Windows</span>
            <span>·</span>
            <Smartphone size={16} />
            <span>Android и iOS</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<AppState | null>(null),
    [loading, setLoading] = useState(true),
    [offline, setOffline] = useState(false);
  const [view, setView] = useState<View>('calendar'),
    [zone, setZone] = useState(localStorage.getItem('partyup.zone') || defaultZone);
  const [modal, setModal] = useState<'create' | null>(null),
    [detail, setDetail] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('upcoming'),
    [day, setDay] = useState(dateKey(new Date(), zone));
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [preferences, setPreferences] = useState<DevicePreferences>(() => loadPreferences('guest'));
  const [preferenceAccount, setPreferenceAccount] = useState('');
  const [toast, setToast] = useState(''),
    [initialError, setInitialError] = useState('');
  const notificationAnchor = useRef<HTMLDivElement>(null);
  const refreshing = useRef<number | null>(null);
  const current = useRef<AppState | null>(null);
  current.current = data;
  const toastFn = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    const version = getSessionVersion();
    if (refreshing.current === version) return;
    refreshing.current = version;
    try {
      const result = await api<AppState>('/api/state');
      setData(result);
      setOffline(false);
    } catch (e) {
      if (e instanceof SessionChangedError) return;
      if (e instanceof ApiError && e.status === 401) {
        await clearToken();
        setData(null);
      } else if (!current.current) throw e;
      else setOffline(true);
    } finally {
      if (refreshing.current === version) refreshing.current = null;
    }
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        if (await loadToken()) {
          await refresh();
          connectDesktop();
        }
      } catch (e) {
        setInitialError(errorText(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);
  useEffect(() => {
    if (data?.user.id) window.scrollTo(0, 0);
  }, [data?.user.id]);
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => {
      void refresh().catch(() => {});
    }, 5000);
    const focus = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', focus);
    };
  }, [Boolean(data), refresh]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(
    () =>
      window.partyup?.onOpen((id) => {
        setDetail(id);
        void refresh();
      }),
    [refresh],
  );
  useEffect(() => {
    if (!mobile || !data) return;
    let done = false;
    let listener: { remove(): Promise<void> } | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      const h = await App.addListener('appStateChange', (s) => {
        if (s.isActive) void refresh();
      });
      if (done) await h.remove();
      else listener = h;
    });
    return () => {
      done = true;
      void listener?.remove();
    };
  }, [Boolean(data), refresh]);
  useEffect(() => {
    if (!data || !mobile || localStorage.getItem('partyup.push') !== 'true' || !data.pushConfigured)
      return;
    void enablePush(
      () => {
        void refresh();
      },
      setDetail,
      data.user.id,
    ).catch((e) => toastFn(errorText(e)));
    return () => {
      void stopPush();
    };
  }, [data?.user.id, data?.pushConfigured, refresh, toastFn]);
  useEffect(() => {
    if (!data) return;
    setPreferences(loadPreferences(preferenceScope(data.user.id)));
    setPreferenceAccount(preferenceScope(data.user.id));
  }, [data?.user.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    if (data && preferenceAccount === preferenceScope(data.user.id))
      void window.partyup
        ?.configure({ scope: preferenceAccount, zone, preferences })
        .catch((e) => toastFn(errorText(e)));
  }, [preferences, preferenceAccount, zone, data?.user.id, toastFn]);
  useEffect(
    () =>
      window.partyup?.onPreferences((value) => {
        if (!current.current) return;
        savePreferences(preferenceScope(current.current.user.id), value);
        setPreferences(value);
      }),
    [],
  );
  useEffect(() => {
    if (!notificationsOpen) return;
    const close = (event: PointerEvent) => {
      if (!notificationAnchor.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [notificationsOpen]);
  function updatePreferences(value: DevicePreferences) {
    savePreferences(preferenceScope(data!.user.id), value);
    setPreferences(value);
  }
  async function logout() {
    logoutPush();
    try {
      await clearToken();
      setInitialError('');
    } catch (e) {
      setInitialError(errorText(e));
    } finally {
      current.current = null;
      setLoading(false);
      setData(null);
      setOffline(false);
      setModal(null);
      setNotificationsOpen(false);
      setDetail('');
      setView('calendar');
      setQuery('');
      setFilter('upcoming');
      setDay(dateKey(new Date(), zone));
      setToast('');
    }
  }
  async function accept(event: GameEvent, status: 'accepted' | 'declined') {
    try {
      await api(`/api/events/${event.id}/reply`, { status });
      await refresh();
      toastFn(
        status === 'accepted'
          ? 'Вы в команде! Встреча подтверждена.'
          : 'Ответ отправлен. Увидимся в следующий раз!',
      );
    } catch (e) {
      toastFn(errorText(e));
    }
  }
  if (loading)
    return (
      <div className="loading">
        <Logo />
        <Busy />
        <span>Собираем команду…</span>
        <button className="button secondary" onClick={logout}>
          <Globe2 size={17} /> Сменить сервер
        </button>
      </div>
    );
  if (!data)
    return (
      <>
        {initialError && (
          <div className="startup-error" role="alert">
            {initialError}
          </div>
        )}
        <Auth onLogin={refresh} />
      </>
    );
  const pending = data.events.filter(
    (e) => !e.cancelled && e.my_status === 'pending' && Date.parse(e.ends_at) > Date.now(),
  );
  const dayEvents = data.events.filter(
    (e) => dateKey(e.starts_at, zone) === (day || dateKey(new Date(), zone)),
  );
  const unread = data.unreadCount ?? data.notifications.filter((n) => !n.is_read).length;
  const activeEvent = data.events.find((e) => e.id === detail);
  const visible = data.events.filter((e) => {
    if (view === 'invitations') return pending.includes(e);
    if (
      filter === 'upcoming' &&
      (e.cancelled || e.my_status === 'declined' || Date.parse(e.ends_at) <= Date.now())
    )
      return false;
    if (filter === 'mine' && e.host_id !== data.user.id) return false;
    if (filter === 'past' && Date.parse(e.ends_at) > Date.now() && !e.cancelled) return false;
    return `${e.game} ${e.title}`.toLowerCase().includes(query.toLowerCase());
  });
  const nav = [
    { id: 'calendar', label: 'Календарь', icon: CalendarDays },
    { id: 'invitations', label: 'Приглашения', icon: Bell },
    { id: 'friends', label: 'Моя команда', icon: Users },
  ] as const;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => {
                setView(item.id);
                setDay(dateKey(new Date(), zone));
              }}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
              {item.id === 'invitations' && pending.length > 0 && (
                <b className="nav-count">{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-calendar">
          <MonthCalendar
            events={data.events}
            zone={zone}
            selected={day}
            onSelect={(d) => {
              setDay(d);
              setView('calendar');
            }}
          />
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            <Settings2 size={19} /> Настройки
          </button>
          <div className="sidebar-profile">
            <Avatar person={data.user} />
            <div>
              <strong>{data.user.name}</strong>
              <span>@{data.user.username}</span>
            </div>
            <button className="icon-button" onClick={logout} title="Выйти" aria-label="Выйти">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Игровой штаб <span>/</span>
            <strong>
              {view === 'calendar'
                ? 'Календарь'
                : view === 'invitations'
                  ? 'Приглашения'
                  : view === 'friends'
                    ? 'Моя команда'
                    : 'Настройки'}
            </strong>
          </div>
          <div className="topbar-right" ref={notificationAnchor}>
            <span className={`connection ${offline ? 'offline' : ''}`}>
              <span />
              {offline ? 'Нет связи' : 'Сервер подключён'}
            </span>
            <button
              className="notification-button icon-button"
              title="Уведомления"
              aria-label={`Уведомления${unread ? ', непрочитанных: ' + unread : ''}`}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen(!notificationsOpen)}
            >
              <Bell size={21} />
              {unread > 0 && <b>{unread}</b>}
            </button>
            {notificationsOpen && (
              <NotificationPopover
                notices={data.notifications}
                unreadCount={unread}
                zone={zone}
                onClose={() => setNotificationsOpen(false)}
                onRead={refresh}
                toast={toastFn}
                onOpen={(id) => {
                  setNotificationsOpen(false);
                  if (id) setDetail(id);
                  else setView('friends');
                }}
              />
            )}
            <Avatar person={data.user} small />
          </div>
        </header>
        <main>
          {offline && (
            <div className="offline-banner">
              <AlertCircle size={17} /> Нет связи с сервером. Показаны последние данные; ответы
              будут доступны после подключения.
            </div>
          )}
          {data.demo && (
            <div className="demo-banner">
              <Sparkles size={14} /> Локальное демо · данные общие для демонстрационных аккаунтов
            </div>
          )}
          {(view === 'calendar' || view === 'invitations') && (
            <>
              <div className="page-heading">
                <div>
                  <span className="section-kicker">
                    {view === 'invitations' ? 'ВАС УЖЕ ЖДУТ' : 'ВРЕМЯ ДЛЯ СВОИХ'}
                  </span>
                  <h1>
                    {view === 'invitations'
                      ? 'Зовут в игру'
                      : view === 'calendar'
                        ? 'Ваш игровой календарь'
                        : `Привет, ${data.user.name} ✌️`}
                  </h1>
                  <p>
                    {view === 'invitations'
                      ? 'Один ответ — и команда станет ближе к сбору.'
                      : 'Отличный вечер начинается с хорошей компании.'}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={offline}
                  onClick={() => setModal('create')}
                >
                  <Plus size={19} /> Создать встречу
                </button>
              </div>
              {view === 'calendar' && (
                <div className="calendar-view">
                  <MonthCalendar
                    events={data.events}
                    zone={zone}
                    selected={day}
                    onSelect={setDay}
                  />
                  <div className="day-events">
                    <div className="section-heading">
                      <h3>{formatDate((day || dateKey(new Date(), zone)) + 'T12:00Z', 'UTC')}</h3>
                      <span className="count-label">{dayEvents.length}</span>
                    </div>
                    {dayEvents.length ? (
                      dayEvents.map((event) => (
                        <button
                          className={`day-event ${event.my_status}`}
                          key={event.id}
                          onClick={() => setDetail(event.id)}
                        >
                          <time>{formatTime(event.starts_at, zone)}</time>
                          <span>
                            <strong>{event.title}</strong>
                            <small>{event.game}</small>
                          </span>
                          <b>
                            {event.cancelled
                              ? 'Отменена'
                              : event.my_status === 'pending'
                                ? 'Приглашение'
                                : event.my_status === 'declined'
                                  ? 'Вы отказались'
                                  : 'Вы участвуете'}
                          </b>
                          <ChevronRight size={17} />
                        </button>
                      ))
                    ) : (
                      <div className="day-empty">
                        <CalendarDays size={26} />
                        <p>На этот день встреч нет</p>
                        <button
                          className="text-button"
                          disabled={offline}
                          onClick={() => setModal('create')}
                        >
                          Создать встречу
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <section className="events-section">
                <div className="section-heading">
                  <h2>
                    {view === 'invitations' ? 'Входящие приглашения' : 'На горизонте'}{' '}
                    <span className="count-label">{visible.length}</span>
                  </h2>
                  <span className="timezone-note">
                    <Globe2 size={14} />
                    {zone.replaceAll('_', ' ')}
                  </span>
                </div>
                {view !== 'invitations' && (
                  <div className="events-toolbar">
                    <div className="tabs">
                      {[
                        ['upcoming', 'Предстоящие'],
                        ['mine', 'Организую я'],
                        ['past', 'Прошедшие'],
                      ].map(([id, label]) => (
                        <button
                          className={filter === id ? 'selected' : ''}
                          key={id}
                          onClick={() => setFilter(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="Поиск встреч"
                        placeholder="Найти встречу"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                {visible.length ? (
                  <div className="event-grid">
                    {visible.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        me={data.user.id}
                        zone={zone}
                        onOpen={() => setDetail(event.id)}
                        onReply={(status) => accept(event, status)}
                        offline={offline}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <CalendarDays size={34} />
                    <h3>
                      {view === 'invitations'
                        ? 'Пока никто не позвал'
                        : query
                          ? 'Ничего не нашлось'
                          : day
                            ? 'В этот день свободно'
                            : 'Самое время собраться'}
                    </h3>
                    <p>
                      {view === 'invitations'
                        ? 'Новые приглашения появятся здесь. А пока можно позвать друзей самому.'
                        : 'Создайте встречу и начните новое приключение с друзьями.'}
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => setModal('create')}
                      disabled={offline}
                    >
                      <Plus size={17} /> Создать встречу
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {view === 'friends' && <Friends data={data} refresh={refresh} toast={toastFn} />}
          {view === 'settings' && (
            <Settings
              preferences={preferences}
              setPreferences={updatePreferences}
              onLogout={logout}
              data={data}
              zone={zone}
              setZone={(value) => {
                setZone(value);
                localStorage.setItem('partyup.zone', value);
              }}
              refresh={refresh}
              onOpen={setDetail}
              toast={toastFn}
            />
          )}
          <footer className="page-footer">
            <span>Сделано для вечеров, которые хочется повторить.</span>
            <span>
              <Gamepad2 size={15} /> partyup.
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        {nav.map((n) => (
          <button
            className={view === n.id ? 'active' : ''}
            key={n.id}
            onClick={() => {
              setView(n.id);
              setDay(dateKey(new Date(), zone));
            }}
          >
            <n.icon size={21} />
            <span>{n.id === 'friends' ? 'Команда' : n.label}</span>
            {n.id === 'invitations' && pending.length > 0 && <i>{pending.length}</i>}
          </button>
        ))}
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
          <Settings2 size={21} />
          <span>Настройки</span>
        </button>
      </nav>
      {modal === 'create' && (
        <CreateEvent
          data={data}
          zone={zone}
          selectedDay={day}
          onClose={() => setModal(null)}
          onCreated={async (id) => {
            setModal(null);
            await refresh();
            setDetail(id);
            toastFn('Встреча создана. Приглашения ждут друзей в приложении.');
          }}
        />
      )}
      {activeEvent && (
        <EventDetail
          event={activeEvent}
          me={data.user.id}
          zone={zone}
          onClose={() => setDetail('')}
          onReply={(status) => accept(activeEvent, status)}
          refresh={refresh}
          toast={toastFn}
          offline={offline}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Скрыть сообщение">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function EventCard({
  event,
  me,
  zone,
  onOpen,
  onReply,
  offline,
}: {
  event: GameEvent;
  me: string;
  zone: string;
  onOpen(): void;
  onReply(s: 'accepted' | 'declined'): Promise<void>;
  offline: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const ended = Date.parse(event.ends_at) <= Date.now();
  const reply = async (s: 'accepted' | 'declined') => {
    setBusy(true);
    try {
      await onReply(s);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`event-card ${event.cancelled ? 'cancelled' : ''}`}>
      <button className="card-art-button" onClick={onOpen} aria-label={`Открыть ${event.title}`}>
        <GameArt game={event.game} />
        <span
          className={`card-badge ${event.cancelled ? 'neutral' : event.my_status === 'pending' ? 'pending' : event.my_status === 'declined' ? 'declined' : 'accepted'}`}
        >
          {event.my_status === 'declined' && !event.cancelled && (
            <div className="declined-banner">
              <X size={19} /> Вы отказались от участия. Организатор получил уведомление.
            </div>
          )}
          {event.cancelled ? (
            'Отменена'
          ) : ended ? (
            'Завершена'
          ) : event.my_status === 'pending' ? (
            'Ждёт ответа'
          ) : event.my_status === 'declined' ? (
            'Вы отказались'
          ) : (
            <>
              <Check size={12} /> Вы в команде
            </>
          )}
        </span>
      </button>
      <div className="event-card-body">
        <div className="event-date">
          <CalendarDays size={15} />
          {formatDate(event.starts_at, zone, { weekday: 'short' })}
          <span>·</span>
          {formatTime(event.starts_at, zone)}
        </div>
        <button className="card-title" onClick={onOpen}>
          <h3>{event.title}</h3>
        </button>
        <div className="event-host">
          <span>
            {event.host_id === me ? 'Вы собираете команду' : `Собирает ${event.host_name}`}
          </span>
          <span>
            <Clock3 size={13} />
            {Math.round((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 360000) / 10} ч
          </span>
        </div>
        <div className="card-participants">
          <div className="participant-summary">
            <strong>
              {event.participants.filter((p) => p.status === 'accepted').length} из{' '}
              {event.participants.length} готовы
            </strong>
            <button className="text-button" onClick={onOpen}>
              Команда
            </button>
          </div>
          <div className="participant-chips">
            {event.participants.map((p) => (
              <span key={p.id} className={`participant-chip ${p.status}`}>
                <Avatar person={p} small />
                <span>{p.name}</span>
                <b>
                  {p.status === 'accepted' ? (
                    <>
                      <CheckCircle2 size={15} /> Готов
                    </>
                  ) : p.status === 'pending' ? (
                    <>
                      <Clock3 size={15} /> Ждём ответ
                    </>
                  ) : (
                    <>
                      <X size={15} /> Отказался
                    </>
                  )}
                </b>
              </span>
            ))}
          </div>
          <button className="icon-button" onClick={onOpen} aria-label={`Обсудить ${event.title}`}>
            <MessageCircle size={18} />
          </button>
        </div>
        {event.my_status === 'pending' && !event.cancelled && !ended ? (
          <div className="card-actions">
            <button
              className="button primary"
              disabled={busy || offline}
              onClick={() => reply('accepted')}
            >
              {busy ? <Busy /> : <Check size={17} />} Я в деле
            </button>
            <button
              className="button danger"
              disabled={busy || offline}
              onClick={() => reply('declined')}
            >
              <X size={17} /> Отказаться
            </button>
          </div>
        ) : (
          <button className="card-detail-button" onClick={onOpen}>
            Открыть встречу <span>Подробнее</span>
          </button>
        )}
      </div>
    </article>
  );
}

function CreateEvent({
  data,
  zone,
  selectedDay,
  onClose,
  onCreated,
}: {
  data: AppState;
  zone: string;
  selectedDay: string;
  onClose(): void;
  onCreated(id: string): Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const tz = zone;
  const tomorrow = dateKey(new Date(Date.now() + 86400000), tz);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData(e.currentTarget);
      const starts_at = zonedUtc(String(form.get('date')), String(form.get('time')), tz);
      const ends_at = new Date(Date.parse(starts_at) + 2 * 60 * 60000).toISOString();
      const result = await api<{ id: string }>('/api/events', {
        title: form.get('title'),
        game: form.get('game'),
        starts_at,
        ends_at,
        timezone: tz,
        notes: form.get('notes'),
        friends: selected,
      });
      await onCreated(result.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Соберём команду" onClose={onClose}>
      <p className="dialog-subtitle">Хороший план — тот, в котором есть ваши друзья.</p>
      {!data.friends.length ? (
        <div className="empty">
          <Users size={32} />
          <h3>Сначала добавьте друзей</h3>
          <p>В разделе «Моя команда» есть ваш код и форма добавления.</p>
          <button className="button secondary" onClick={onClose}>
            Понятно
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="create-form">
          <label>
            Название игры
            <input
              name="game"
              required
              minLength={2}
              maxLength={60}
              placeholder="Введите название игры"
              autoFocus
            />
          </label>
          <label>
            Как назовём вечер?
            <input
              name="title"
              required
              minLength={2}
              maxLength={80}
              placeholder="Например, пятничный кооп"
            />
          </label>
          <div className="form-row">
            <label>
              Дата
              <input
                type="date"
                name="date"
                defaultValue={selectedDay || tomorrow}
                min={dateKey(new Date(), tz)}
                required
              />
            </label>
            <label>
              Начало
              <input type="time" name="time" defaultValue="20:00" required />
            </label>
          </div>
          <p className="field-hint">Время в вашем часовом поясе: {zone.replaceAll('_', ' ')}.</p>
          <div className="form-friends">
            <div className="field-label">
              Кого зовём?{' '}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setSelected(
                    selected.length === data.friends.length ? [] : data.friends.map((f) => f.id),
                  )
                }
              >
                {selected.length === data.friends.length ? 'Снять выбор' : 'Выбрать всех'}
              </button>
            </div>
            <div className="friend-picker">
              {data.friends.map((friend) => (
                <label key={friend.id} className={selected.includes(friend.id) ? 'picked' : ''}>
                  <input
                    type="checkbox"
                    checked={selected.includes(friend.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, friend.id]
                          : selected.filter((id) => id !== friend.id),
                      )
                    }
                  />
                  <Avatar person={friend} small />
                  <span>{friend.name}</span>
                  {selected.includes(friend.id) ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </label>
              ))}
            </div>
          </div>
          <label>
            Пара слов для команды <span className="muted">· необязательно</span>
            <textarea
              name="notes"
              maxLength={1000}
              rows={2}
              placeholder="Режим, пожелания и план на вечер…"
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              <AlertCircle size={17} />
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <span className="muted">
              <Bell size={15} /> Приглашения получат только выбранные друзья
            </span>
            <button className="button primary" disabled={busy || !selected.length}>
              {busy ? <Busy /> : <Send size={17} />} Отправить приглашения
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EventDetail({
  event,
  me,
  zone,
  onClose,
  onReply,
  refresh,
  toast,
  offline,
}: {
  event: GameEvent;
  me: string;
  zone: string;
  onClose(): void;
  onReply(s: 'accepted' | 'declined'): Promise<void>;
  refresh(): Promise<void>;
  toast(s: string): void;
  offline: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [chat, setChat] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api<Message[]>(`/api/events/${event.id}/messages`);
        if (!cancelled) {
          setMessages(result);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [event.id]);
  useEffect(() => {
    if (messages.length !== count.current) {
      bottom.current?.scrollIntoView({ block: 'nearest' });
      count.current = messages.length;
    }
  }, [messages.length]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!chat.trim()) return;
    setBusy(true);
    try {
      await api(`/api/events/${event.id}/messages`, { text: chat });
      setChat('');
      setMessages(await api(`/api/events/${event.id}/messages`));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ended = Date.parse(event.ends_at) <= Date.now();
  return (
    <Dialog title={event.title} onClose={onClose} wide>
      <div className="detail-layout">
        <div className="detail-info">
          <GameArt game={event.game} />
          <div className="detail-facts">
            <p>
              <CalendarDays size={18} />
              <span>{formatDate(event.starts_at, zone, { weekday: 'long' })}</span>
            </p>
            <p>
              <Clock3 size={18} />
              <span>
                {formatTime(event.starts_at, zone)}–{formatTime(event.ends_at, zone)}{' '}
                <small>{zone}</small>
              </span>
            </p>
          </div>
          {event.notes && <p className="event-notes">{event.notes}</p>}
          <h3 className="small-heading">
            Команда <span>{event.participants.length}</span>
          </h3>
          <div className="participant-list">
            {event.participants.map((p) => (
              <div key={p.id}>
                <Avatar person={p} small />
                <span>
                  {p.name}
                  {p.id === event.host_id && <small>Организатор</small>}
                </span>
                <b className={p.status}>
                  {p.status === 'accepted' ? (
                    <>
                      <CheckCircle2 size={15} /> Готов
                    </>
                  ) : p.status === 'pending' ? (
                    <>
                      <Clock3 size={15} /> Ждём ответ
                    </>
                  ) : (
                    <>
                      <X size={15} /> Отказался
                    </>
                  )}
                </b>
              </div>
            ))}
          </div>
          {event.my_status === 'declined' && !event.cancelled && (
            <div className="declined-banner">
              <X size={19} /> Вы отказались от участия. Организатор получил уведомление.
            </div>
          )}
          {event.cancelled ? (
            <div className="form-error">Встреча отменена организатором.</div>
          ) : (
            <div className="detail-buttons">
              {!ended && event.host_id !== me && (
                <>
                  <button
                    className={`button ${event.my_status === 'accepted' ? 'danger' : 'primary'} full`}
                    disabled={busy || offline}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onReply(event.my_status === 'accepted' ? 'declined' : 'accepted');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? (
                      <Busy />
                    ) : event.my_status === 'accepted' ? (
                      'Отказаться от участия'
                    ) : (
                      'Я в деле'
                    )}
                  </button>
                  {event.my_status === 'pending' && (
                    <button
                      className="button danger full"
                      disabled={busy || offline}
                      onClick={() => onReply('declined')}
                    >
                      <X size={17} /> Отклонить приглашение
                    </button>
                  )}
                </>
              )}
              {event.host_id === me &&
                !ended &&
                (confirm ? (
                  <div className="cancel-confirm">
                    <p>Отменить встречу для всей команды?</p>
                    <button
                      className="button danger"
                      disabled={busy || offline}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(`/api/events/${event.id}/cancel`, {});
                          await refresh();
                          toast('Встреча отменена. Участники увидят уведомление.');
                        } catch (e) {
                          toast(errorText(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Да, отменить
                    </button>
                    <button className="text-button" onClick={() => setConfirm(false)}>
                      Оставить
                    </button>
                  </div>
                ) : (
                  <button className="text-button danger-text" onClick={() => setConfirm(true)}>
                    Отменить встречу
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className="detail-chat">
          <div className="chat-heading">
            <MessageCircle size={19} />
            <strong>Обсудим планы</strong>
          </div>
          <div className="messages">
            {messages.length ? (
              messages.map((m) => (
                <div className={`message ${m.user_id === me ? 'own' : ''}`} key={m.id}>
                  <Avatar person={{ id: m.user_id, name: m.name, color: m.color }} small />
                  <div>
                    <div className="message-meta">
                      <strong>{m.name}</strong>
                      <time>{formatTime(m.created_at, zone)}</time>
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="chat-empty">
                <MessageCircle size={28} />
                <p>
                  Здесь можно договориться
                  <br />о деталях вечера.
                </p>
              </div>
            )}
            <div ref={bottom} />
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <form className="chat-input" onSubmit={send}>
            <input
              aria-label="Сообщение команде"
              placeholder={event.cancelled ? 'Встреча отменена' : 'Написать команде…'}
              value={chat}
              maxLength={1000}
              onChange={(e) => setChat(e.target.value)}
              disabled={Boolean(event.cancelled) || offline}
            />
            <button
              className="button primary"
              disabled={busy || !chat.trim() || Boolean(event.cancelled) || offline}
              aria-label="Отправить сообщение"
            >
              {busy ? <Busy /> : <Send size={18} />}
            </button>
          </form>
        </div>
      </div>
    </Dialog>
  );
}

function Friends({
  data,
  refresh,
  toast,
}: {
  data: AppState;
  refresh(): Promise<void>;
  toast(s: string): void;
}) {
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/friends', { code });
      setCode('');
      await refresh();
      toast('Заявка отправлена. Друг сможет принять её в приложении.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="section-kicker">ЛЮДИ, С КОТОРЫМИ ХОРОШО</span>
          <h1>Ваша команда</h1>
          <p>Отправьте свой код другу — и больше не теряйтесь.</p>
        </div>
      </div>
      <div className="friends-tools">
        <div className="panel invite-code">
          <span className="section-kicker">ВАШ КОД ДРУГА</span>
          <strong>{data.user.friend_code}</strong>
          <button
            className="button secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(data.user.friend_code || '')
                .then(() => toast('Код скопирован'))
                .catch(() => toast('Не удалось скопировать. Выделите код вручную.'));
            }}
          >
            <Copy size={16} /> Скопировать код
          </button>
        </div>
        <form onSubmit={submit} className="panel">
          <h3>Добавить друга</h3>
          <p className="muted">Введите код из его профиля.</p>
          <div className="inline-form">
            <input
              aria-label="Код друга"
              placeholder="Код друга"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              minLength={6}
              maxLength={32}
            />
            <button className="button primary" disabled={busy}>
              {busy ? <Busy /> : <Plus size={18} />} Добавить
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
      {data.requests.length > 0 && (
        <section className="friend-requests">
          <h2>Заявки в друзья</h2>
          {data.requests.map((r) => (
            <div className="request-row panel" key={r.id}>
              <Avatar person={r} />
              <div>
                <strong>{r.name}</strong>
                <span className="muted">@{r.username}</span>
              </div>
              {r.sender_id === data.user.id ? (
                <span className="status-pill">Ждём ответ</span>
              ) : (
                <>
                  <button
                    disabled={busy}
                    className="button primary"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/api/friends/requests/${r.id}`, { accept: true });
                        await refresh();
                        toast('Друг добавлен в команду');
                      } catch (e) {
                        toast(errorText(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Принять
                  </button>
                  <button
                    disabled={busy}
                    className="icon-button"
                    aria-label="Отклонить заявку"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/api/friends/requests/${r.id}`, { accept: false });
                        await refresh();
                      } catch (e) {
                        toast(errorText(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <X size={20} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      <div className="section-heading">
        <h2>
          Свои люди <span className="count-label">{data.friends.length}</span>
        </h2>
      </div>
      {data.friends.length ? (
        <div className="friends-grid">
          {data.friends.map((friend) => (
            <div className="panel friend-card" key={friend.id}>
              <Avatar person={friend} />
              <h3>{friend.name}</h3>
              <span className="muted">@{friend.username}</span>
              <div className="friend-card-foot">
                <ShieldCheck size={15} /> В вашей команде
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Users size={32} />
          <h3>Каждой команде нужен первый друг</h3>
          <p>Поделитесь кодом или отправьте заявку по коду друга.</p>
        </div>
      )}
    </>
  );
}
