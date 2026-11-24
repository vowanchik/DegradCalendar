import { useCallback, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Gamepad2,
  Headphones,
  LayoutGrid,
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
  Zap,
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
  desktop,
  loadToken,
  mobile,
  saveToken,
  serverUrl,
  setServerUrl,
} from './api';
import {
  addCalendar,
  enablePush,
  logoutPush,
  removeCalendar,
  stopPush,
  FirebaseMessaging,
} from './integrations';
import { dateKey, defaultZone, formatDate, formatTime, zonedUtc, zones } from './time';
import type { AppState, GameEvent, Message, Person } from './types';

const games = [
  'Counter-Strike 2',
  'Helldivers 2',
  'Minecraft',
  'Dota 2',
  'Baldur’s Gate 3',
  'Другая игра',
];
type View = 'schedule' | 'calendar' | 'invitations' | 'friends' | 'settings';
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
function MonthCalendar({
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
              onClick={() => onSelect(selected === key ? '' : key)}
              className={`${key === selected ? 'selected' : ''} ${key === today ? 'today' : ''} ${has ? 'has-event' : ''}`}
              aria-label={`${i + 1} ${new Intl.DateTimeFormat('ru', { month: 'long', timeZone: 'UTC' }).format(month)}${has ? ', есть встречи' : ''}`}
              aria-pressed={key === selected}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      {selected && (
        <button className="text-button calendar-reset" onClick={() => onSelect('')}>
          Показать все даты <X size={13} />
        </button>
      )}
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
                placeholder="https://party.example.com"
                type="url"
                required
              />
              <span className="field-hint">
                На всех устройствах должен быть указан один сервер.
              </span>
            </label>
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
  const [view, setView] = useState<View>('schedule'),
    [zone, setZone] = useState(localStorage.getItem('partyup.zone') || defaultZone);
  const [modal, setModal] = useState<'create' | 'notifications' | null>(null),
    [detail, setDetail] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('upcoming'),
    [day, setDay] = useState('');
  const [toast, setToast] = useState(''),
    [initialError, setInitialError] = useState('');
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
  // Remove previously exported native events after cancellation or a changed RSVP.
  useEffect(() => {
    if (!mobile || !data) return;
    for (const e of data.events)
      if (e.cancelled || e.my_status === 'declined')
        void removeCalendar(e, data.user.id).catch(() => {});
  }, [data]);
  useEffect(() => {
    if (!data || !mobile || localStorage.getItem('partyup.push') !== 'true' || !data.pushConfigured)
      return;
    void enablePush(() => {
      void refresh();
    }, setDetail).catch((e) => toastFn(errorText(e)));
    return () => {
      void stopPush();
    };
  }, [data?.user.id, data?.pushConfigured, refresh, toastFn]);
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
      setDetail('');
      setView('schedule');
      setQuery('');
      setFilter('upcoming');
      setDay('');
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
      if (
        status === 'accepted' &&
        mobile &&
        localStorage.getItem('partyup.autoCalendar') !== 'false'
      )
        try {
          await addCalendar(event, data!.user.id);
          toastFn('Вы в команде! Встреча добавлена в календарь.');
        } catch (e) {
          toastFn(`Ответ сохранён. Календарь: ${errorText(e)}`);
        }
      if (status === 'declined') await removeCalendar(event, data!.user.id);
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
  const upcoming = data.events.filter(
    (e) => !e.cancelled && e.my_status === 'accepted' && Date.parse(e.ends_at) > Date.now(),
  );
  const unread = data.notifications.filter((n) => !n.is_read).length;
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
    if (day && dateKey(e.starts_at, zone) !== day) return false;
    return `${e.game} ${e.title}`.toLowerCase().includes(query.toLowerCase());
  });
  const nav = [
    { id: 'schedule', label: 'Мои встречи', icon: LayoutGrid },
    { id: 'calendar', label: 'Календарь', icon: CalendarDays },
    { id: 'invitations', label: 'Приглашения', icon: Bell },
    { id: 'friends', label: 'Моя команда', icon: Users },
  ] as const;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-tag">
          <span className="workspace-icon">
            <Gamepad2 size={19} />
          </span>
          <div>
            <strong>Игровой штаб</strong>
            <span>Только вы и ваши друзья</span>
          </div>
        </div>
        <span className="nav-label">ВАШЕ ПРОСТРАНСТВО</span>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => {
                setView(item.id);
                setDay('');
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
          <div className="sidebar-note">
            <Sparkles size={20} />
            <strong>Лучше вместе</strong>
            <p>
              Хорошая компания —<br />
              уже половина победы.
            </p>
          </div>
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
              {view === 'schedule'
                ? 'Обзор'
                : view === 'calendar'
                  ? 'Календарь'
                  : view === 'invitations'
                    ? 'Приглашения'
                    : view === 'friends'
                      ? 'Моя команда'
                      : 'Настройки'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`connection ${offline ? 'offline' : ''}`}>
              <span />
              {offline ? 'Нет связи' : 'Сервер подключён'}
            </span>
            <button
              className="notification-button icon-button"
              title="Уведомления"
              aria-label={`Уведомления${unread ? ', непрочитанных: ' + unread : ''}`}
              onClick={() => setModal('notifications')}
            >
              <Bell size={21} />
              {unread > 0 && <b>{unread}</b>}
            </button>
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
          {(view === 'schedule' || view === 'calendar' || view === 'invitations') && (
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
              {view === 'schedule' && (
                <>
                  <section className="hero">
                    <img
                      src="./assets/expedition.svg"
                      alt="Путешественники у портала в зелёных горах"
                    />
                    <div className="hero-shade" />
                    <div className="hero-content">
                      <span className="hero-label">
                        <span>✦</span> СЛЕДУЮЩЕЕ ПРИКЛЮЧЕНИЕ — ВАШЕ
                      </span>
                      <h2>
                        В одиночку — игра.
                        <br />
                        Вместе — <em>история.</em>
                      </h2>
                      <p>
                        Выберите игру, позовите друзей.
                        <br />
                        Мы поможем собрать всех в одно время.
                      </p>
                      <button
                        className="button hero-button"
                        disabled={offline}
                        onClick={() => setModal('create')}
                      >
                        <Gamepad2 size={18} /> Собрать команду
                      </button>
                    </div>
                    <div className="hero-footnote">
                      <span>CO-OP IS A STATE OF MIND</span>
                      <Sparkles size={15} />
                    </div>
                  </section>
                  <div className="stats">
                    <div>
                      <span className="stat-icon mint">
                        <CalendarDays size={21} />
                      </span>
                      <div>
                        <strong>
                          {upcoming.length}
                          <span>в планах</span>
                        </strong>
                        <p>Подтверждённых встреч</p>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon lavender">
                        <Bell size={21} />
                      </span>
                      <div>
                        <strong>
                          {pending.length}
                          <span>приглашений</span>
                        </strong>
                        <p>Ждут вашего ответа</p>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon peach">
                        <Users size={21} />
                      </span>
                      <div>
                        <strong>
                          {data.friends.length}
                          <span>в команде</span>
                        </strong>
                        <p>Друзей для хороших каток</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              {view === 'calendar' && (
                <div className="calendar-view">
                  <MonthCalendar
                    events={data.events}
                    zone={zone}
                    selected={day}
                    onSelect={setDay}
                  />
                  <div>
                    <CalendarDays size={32} />
                    <h3>{day ? formatDate(day + 'T12:00Z', 'UTC') : 'Выберите день для игры'}</h3>
                    <p className="muted">
                      Дни с точкой — ваши запланированные встречи.
                      <br />
                      Время отображается в поясе {zone}.
                    </p>
                  </div>
                </div>
              )}
              <section className="events-section">
                <div className="section-heading">
                  <h2>
                    {view === 'invitations'
                      ? 'Входящие приглашения'
                      : day
                        ? formatDate(day + 'T12:00Z', 'UTC')
                        : 'На горизонте'}{' '}
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
              setDay('');
            }}
          >
            <n.icon size={21} />
            <span>
              {n.id === 'schedule' ? 'Встречи' : n.id === 'friends' ? 'Команда' : n.label}
            </span>
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
      {modal === 'notifications' && (
        <Dialog title="Уведомления" onClose={() => setModal(null)}>
          <div className="notice-top">
            <span className="muted">
              {unread ? 'Непрочитанных: ' + unread : 'Вы всё прочитали'}
            </span>
            <button
              className="text-button"
              disabled={!unread}
              onClick={() => {
                void api('/api/notifications/read', {})
                  .then(refresh)
                  .catch((e) => toastFn(errorText(e)));
              }}
            >
              <CheckCheck size={16} /> Прочитать все
            </button>
          </div>
          <div className="notices">
            {data.notifications.length ? (
              data.notifications.map((n) => (
                <button
                  key={n.id}
                  className={`notice ${!n.is_read ? 'unread' : ''}`}
                  onClick={() => {
                    setModal(null);
                    if (n.event_id) setDetail(n.event_id);
                    else setView('friends');
                  }}
                >
                  <span className="notice-icon">
                    {n.kind === 'message' ? (
                      <MessageCircle size={18} />
                    ) : n.kind === 'friend' ? (
                      <Users size={18} />
                    ) : (
                      <Bell size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                    <time>
                      {formatDate(n.created_at, zone)} · {formatTime(n.created_at, zone)}
                    </time>
                  </div>
                  {!n.is_read && <i />}
                </button>
              ))
            ) : (
              <div className="empty">
                <Bell />
                <h3>Всё спокойно</h3>
                <p>Здесь будут приглашения, ответы и напоминания.</p>
              </div>
            )}
          </div>
        </Dialog>
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
          className={`card-badge ${event.cancelled ? 'neutral' : event.my_status === 'pending' ? 'pending' : event.my_status === 'declined' ? 'neutral' : 'accepted'}`}
        >
          {event.cancelled ? (
            'Отменена'
          ) : ended ? (
            'Завершена'
          ) : event.my_status === 'pending' ? (
            'Ждёт ответа'
          ) : event.my_status === 'declined' ? (
            'Не участвую'
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
          <div className="avatar-stack">
            {event.participants.slice(0, 5).map((p) => (
              <Avatar key={p.id} person={p} small />
            ))}
          </div>
          <span>
            <b>{event.participants.filter((p) => p.status === 'accepted').length}</b> из{' '}
            {event.participants.length} в сборе
          </span>
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
              className="button secondary"
              disabled={busy || offline}
              onClick={() => reply('declined')}
            >
              Не смогу
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
    [game, setGame] = useState(games[0]),
    [tz, setTz] = useState(zone),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const tomorrow = dateKey(new Date(Date.now() + 86400000), tz);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData(e.currentTarget);
      const starts_at = zonedUtc(String(form.get('date')), String(form.get('time')), tz);
      const ends_at = new Date(
        Date.parse(starts_at) + Number(form.get('duration')) * 60000,
      ).toISOString();
      const result = await api<{ id: string }>('/api/events', {
        title: form.get('title'),
        game: game === 'Другая игра' ? form.get('customGame') : game,
        starts_at,
        ends_at,
        timezone: tz,
        notes: form.get('notes'),
        location: form.get('location'),
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
            Во что играем?
            <select value={game} onChange={(e) => setGame(e.target.value)}>
              {games.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          {game === 'Другая игра' && (
            <label>
              Название игры
              <input
                name="customGame"
                required
                minLength={2}
                maxLength={60}
                placeholder="Например, Sea of Thieves"
              />
            </label>
          )}
          <label>
            Как назовём вечер?
            <input
              name="title"
              required
              minLength={2}
              maxLength={80}
              placeholder="Например, пятничный кооп"
              autoFocus
            />
          </label>
          <div className="form-row three">
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
            <label>
              На сколько?
              <select name="duration" defaultValue="120">
                {[60, 90, 120, 180, 240, 360].map((n) => (
                  <option key={n} value={n}>
                    {n / 60} ч
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Часовой пояс
            <select value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
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
            Где общаемся?
            <input name="location" defaultValue="Discord · общий голосовой" maxLength={120} />
          </label>
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
            <p>
              <Headphones size={18} />
              <span>{event.location}</span>
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
                  {p.status === 'accepted'
                    ? 'В деле'
                    : p.status === 'pending'
                      ? 'Ждём ответ'
                      : 'Не сможет'}
                </b>
              </div>
            ))}
          </div>
          {event.cancelled ? (
            <div className="form-error">Встреча отменена организатором.</div>
          ) : (
            <div className="detail-buttons">
              {event.my_status === 'accepted' && (
                <button
                  className="button secondary full"
                  disabled={offline}
                  onClick={() => {
                    void addCalendar(event, me)
                      .then(() =>
                        toast(
                          mobile
                            ? 'Событие сохранено в календарь'
                            : 'Файл календаря подготовлен. Откройте его в своём приложении календаря.',
                        ),
                      )
                      .catch((e) => toast(errorText(e)));
                  }}
                >
                  <Download size={17} /> {mobile ? 'Добавить в календарь' : 'Скачать событие .ics'}
                </button>
              )}
              {!ended && event.host_id !== me && (
                <>
                  <button
                    className="button primary full"
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
                      'Изменить ответ: не смогу'
                    ) : (
                      'Я в деле'
                    )}
                  </button>
                  {event.my_status === 'pending' && (
                    <button
                      className="text-button"
                      disabled={busy || offline}
                      onClick={() => onReply('declined')}
                    >
                      Не смогу в этот раз
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

function Settings({
  data,
  zone,
  setZone,
  refresh,
  onOpen,
  toast,
  onLogout,
}: {
  onLogout(): Promise<void>;
  data: AppState;
  zone: string;
  setZone(s: string): void;
  refresh(): Promise<void>;
  onOpen(s: string): void;
  toast(s: string): void;
}) {
  const [autoCalendar, setAutoCalendar] = useState(
      localStorage.getItem('partyup.autoCalendar') !== 'false',
    ),
    [pushEnabled, setPushEnabled] = useState(localStorage.getItem('partyup.push') === 'true'),
    [autoStart, setAutoStart] = useState(localStorage.getItem('partyup.autostart') === 'true'),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="section-kicker">ВСЁ ПОД ВАШ РИТМ</span>
          <h1>Настройки</h1>
          <p>Чтобы команда собиралась, а важное не терялось.</p>
        </div>
      </div>
      <div className="settings-profile panel">
        <Avatar person={data.user} />
        <div>
          <strong>{data.user.name}</strong>
          <span>@{data.user.username}</span>
        </div>
        <button className="button secondary" onClick={onLogout}>
          <LogOut size={17} /> Выйти
        </button>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <span className="settings-icon">
            <Globe2 />
          </span>
          <h2>Время и даты</h2>
          <p className="muted">
            Друзья могут быть в разных городах. Каждый увидит начало по своему часовому поясу.
          </p>
          <label>
            Ваш часовой пояс
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <p className="setting-footnote">Встречи хранятся на сервере в UTC.</p>
        </section>
        <section className="panel settings-panel">
          <span className="settings-icon lavender">
            <Bell />
          </span>
          <h2>Уведомления</h2>
          <p className="muted">
            Приглашения, ответы, сообщения и напоминание за 15 минут до начала.
          </p>
          {mobile ? (
            <>
              <div className="setting-row">
                <span>Мобильные push</span>
                <button
                  className={`toggle ${pushEnabled ? 'on' : ''}`}
                  role="switch"
                  aria-checked={pushEnabled}
                  aria-label="Мобильные push"
                  disabled={busy || !data.pushConfigured}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (pushEnabled) {
                        await stopPush();
                        await FirebaseMessaging.deleteToken();
                      } else
                        await enablePush(() => {
                          void refresh();
                        }, onOpen);
                      localStorage.setItem('partyup.push', String(!pushEnabled));
                      setPushEnabled(!pushEnabled);
                      toast(
                        pushEnabled
                          ? 'Push отключены на этом устройстве'
                          : 'Уведомления подключены',
                      );
                    } catch (e) {
                      toast(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span />
                </button>
              </div>
              {!data.pushConfigured && (
                <p className="setting-footnote">
                  Администратору нужно подключить Firebase на сервере и в мобильной сборке.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="native-note">
                <Monitor size={19} />
                {desktop
                  ? 'Windows-уведомления работают, пока приложение запущено в трее.'
                  : 'Это предпросмотр интерфейса. Системные уведомления доступны в Windows-приложении.'}
              </div>
              {desktop && (
                <div className="setting-row">
                  <span>Запускать при входе в Windows</span>
                  <button
                    className={`toggle ${autoStart ? 'on' : ''}`}
                    role="switch"
                    aria-checked={autoStart}
                    aria-label="Запускать при входе в Windows"
                    onClick={async () => {
                      try {
                        await window.partyup!.setAutoStart(!autoStart);
                        localStorage.setItem('partyup.autostart', String(!autoStart));
                        setAutoStart(!autoStart);
                      } catch (e) {
                        toast(errorText(e));
                      }
                    }}
                  >
                    <span />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <section className="panel settings-panel">
          <span className="settings-icon peach">
            <CalendarDays />
          </span>
          <h2>Системный календарь</h2>
          {mobile ? (
            <>
              <p className="muted">
                После принятия приглашения сохранять встречу в календарь телефона. При первом
                сохранении система запросит разрешение.
              </p>
              <div className="setting-row">
                <span>Добавлять после принятия</span>
                <button
                  role="switch"
                  aria-checked={autoCalendar}
                  aria-label="Добавлять после принятия"
                  className={`toggle ${autoCalendar ? 'on' : ''}`}
                  onClick={() => {
                    localStorage.setItem('partyup.autoCalendar', String(!autoCalendar));
                    setAutoCalendar(!autoCalendar);
                  }}
                >
                  <span />
                </button>
              </div>
              <p className="setting-footnote">
                Отмены удаляются из календаря при открытии приложения. Если календарь недоступен,
                ваш ответ всё равно сохранится.
              </p>
            </>
          ) : (
            <>
              <p className="muted">
                В принятой встрече можно скачать файл .ics и открыть его в приложении календаря,
                которое поддерживает импорт.
              </p>
              <p className="setting-footnote">
                Изменения и отмены в уже импортированный файл автоматически не попадут.
              </p>
            </>
          )}
        </section>
        <section className="panel settings-panel">
          <span className="settings-icon">
            <ShieldCheck />
          </span>
          <h2>Ваше пространство</h2>
          <p className="muted">
            Встречи доступны только организатору и приглашённым участникам. Добавление в друзья
            требует подтверждения.
          </p>
          <div className="server-address">
            <span>Общий сервер</span>
            <code>{serverUrl()}</code>
          </div>
          <button className="button secondary full" style={{ marginTop: 16 }} onClick={onLogout}>
            <Globe2 size={17} /> Сменить сервер
          </button>
          <p className="setting-footnote">
            Смена сервера завершает сессию на этом устройстве и доступна без подключения. Версия
            0.1.1 ·{' '}
            {mobile ? 'Мобильное приложение' : desktop ? 'Windows-приложение' : 'Предпросмотр'}
          </p>
        </section>
      </div>
    </>
  );
}
