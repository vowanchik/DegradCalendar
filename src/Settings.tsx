import { useEffect, useState, type FormEvent } from 'react';
import {
  Bell,
  CalendarDays,
  Globe2,
  LogOut,
  Palette,
  Play,
  RotateCcw,
  ShieldCheck,
  Upload,
  Volume2,
} from 'lucide-react';
import { api, desktop, mobile, native, getSessionVersion, serverUrl, platform } from './api';
import { disablePush, enablePush, syncPushSounds } from './integrations';
import { preferenceScope, soundKinds } from './preferences';
import { zones } from './time';
import type { AppState, DevicePreferences, SoundKind } from './types';

function Toggle({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange(): void;
}) {
  return (
    <button
      className={`toggle ${value ? 'on' : ''}`}
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
export function Settings({
  data,
  zone,
  setZone,
  preferences,
  setPreferences,
  refresh,
  onOpen,
  toast,
  onLogout,
}: {
  data: AppState;
  zone: string;
  setZone(value: string): void;
  preferences: DevicePreferences;
  setPreferences(value: DevicePreferences): void;
  refresh(): Promise<void>;
  onOpen(id: string): void;
  toast(message: string): void;
  onLogout(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [alarmEnabled, setAlarmEnabled] = useState(data.preferences?.alarmEnabled ?? true);
  const [alarmMinutes, setAlarmMinutes] = useState(data.preferences?.alarmMinutes ?? 15);
  const [pushEnabled, setPushEnabled] = useState(localStorage.getItem('partyup.push') === 'true');
  const [autoStart, setAutoStart] = useState(localStorage.getItem('partyup.autostart') === 'true');
  useEffect(() => {
    setAlarmEnabled(data.preferences?.alarmEnabled ?? true);
    setAlarmMinutes(data.preferences?.alarmMinutes ?? 15);
  }, [data.preferences?.alarmEnabled, data.preferences?.alarmMinutes]);
  const report = (error: unknown) =>
    toast(error instanceof Error ? error.message : 'Не удалось сохранить настройки');
  async function saveAlarm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/preferences', { alarmEnabled, alarmMinutes });
      await refresh();
      toast('Настройки будильника сохранены');
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function changeSound(kind: SoundKind, file?: File) {
    setBusy(true);
    const version = getSessionVersion();
    try {
      let dataUrl = '';
      if (file) {
        if (file.size > 2 * 1024 * 1024)
          throw new Error('Выберите звуковой файл до 2 МБ и длительностью до 30 секунд');
        if (!/\.(wav|mp3|ogg|m4a|caf|aiff?)$/i.test(file.name))
          throw new Error('Выберите звуковой файл WAV, MP3, OGG, M4A, CAF или AIFF');
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
          reader.readAsDataURL(file);
        });
        const extension = file.name.split('.').pop()!.toLowerCase();
        const mime = (
          {
            wav: 'audio/wav',
            mp3: 'audio/mpeg',
            ogg: 'audio/ogg',
            m4a: 'audio/mp4',
            caf: 'audio/x-caf',
            aif: 'audio/aiff',
            aiff: 'audio/aiff',
          } as Record<string, string>
        )[extension];
        dataUrl = dataUrl.replace(/^data:[^;]*;/, `data:${mime};`);
      }
      if (version !== getSessionVersion()) return;
      const choice = desktop
        ? await window.partyup!.setSound(
            file ? { kind, name: file.name, dataUrl } : { kind, reset: true },
          )
        : await native.setSound({
            scope: preferenceScope(data.user.id),
            kind,
            name: file?.name,
            dataUrl,
            reset: !file,
          });
      if (version !== getSessionVersion()) return;
      const sounds = { ...preferences.sounds };
      if (file && choice) sounds[kind] = choice;
      else delete sounds[kind];
      setPreferences({ ...preferences, sounds });
      await syncPushSounds();
      toast(file ? 'Звук сохранён на этом устройстве' : 'Восстановлен стандартный системный звук');
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="section-kicker">ВСЁ ПОД ВАШ РИТМ</span>
          <h1>Настройки</h1>
          <p>Календарь, напоминания и оформление под вас.</p>
        </div>
      </div>
      <div className="settings-profile panel">
        <span className="avatar" style={{ background: data.user.color, color: '#162019' }}>
          {data.user.name.slice(0, 1)}
        </span>
        <div>
          <strong>{data.user.name}</strong>
          <span>@{data.user.username}</span>
        </div>
        <button className="button secondary" onClick={onLogout}>
          <LogOut size={17} /> Выйти
        </button>
      </div>
      <div className="settings-list">
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <Palette />
            <div>
              <h2>Цветовая схема</h2>
              <p className="muted">Оформление приложения и виджета на этом устройстве.</p>
            </div>
          </div>
          <div className="theme-options">
            {(
              [
                ['forest', 'Лес'],
                ['ocean', 'Океан'],
                ['violet', 'Сумерки'],
                ['light', 'Светлая'],
              ] as const
            ).map(([theme, label]) => (
              <button
                key={theme}
                className={`theme-option theme-${theme} ${preferences.theme === theme ? 'selected' : ''}`}
                aria-pressed={preferences.theme === theme}
                onClick={() => setPreferences({ ...preferences, theme })}
              >
                <span className="theme-preview">
                  <i />
                  <i />
                  <i />
                </span>
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <Globe2 />
            <div>
              <h2>Время и даты</h2>
              <p className="muted">Время встреч отображается в вашем часовом поясе.</p>
            </div>
          </div>
          <label className="setting-control">
            Ваш часовой пояс
            <select value={zone} onChange={(event) => setZone(event.target.value)}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
        </section>
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <Bell />
            <div>
              <h2>Будильник перед встречей</h2>
              <p className="muted">
                Напоминать о встречах, в которых вы участвуете. Настройка действует на всех ваших
                устройствах.
              </p>
            </div>
          </div>
          <form onSubmit={saveAlarm}>
            <div className="setting-row">
              <span>Предупреждать до начала</span>
              <Toggle
                label="Будильник перед встречей"
                value={alarmEnabled}
                disabled={busy}
                onChange={() => setAlarmEnabled(!alarmEnabled)}
              />
            </div>
            <div className="alarm-controls">
              <label>
                За сколько минут
                <input
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  required
                  value={alarmMinutes}
                  disabled={!alarmEnabled || busy}
                  onChange={(e) => setAlarmMinutes(Number(e.target.value))}
                />
              </label>
              <button className="button primary" disabled={busy}>
                Сохранить
              </button>
            </div>
            <p className="setting-footnote">
              От 1 минуты до 7 дней. В Windows приложение должно работать в трее; на телефоне
              включите push.
            </p>
          </form>
        </section>
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <Volume2 />
            <div>
              <h2>Звуки уведомлений</h2>
              <p className="muted">
                Для каждого типа можно выбрать свой звук. По умолчанию — стандартное уведомление{' '}
                {desktop ? 'Windows' : 'системы'}.
              </p>
            </div>
          </div>
          {desktop || mobile ? (
            <>
              <div className="sound-list">
                {soundKinds.map(([kind, label]) => (
                  <div className="sound-row" key={kind}>
                    <div>
                      <strong>{label}</strong>
                      <span>{preferences.sounds[kind]?.name || 'Стандартный системный звук'}</span>
                    </div>
                    <div className="sound-actions">
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Прослушать: ${label}`}
                        onClick={() => {
                          void (
                            desktop
                              ? window.partyup!.previewSound(kind)
                              : native.previewSound({ scope: preferenceScope(data.user.id), kind })
                          ).catch(report);
                        }}
                      >
                        <Play size={17} />
                      </button>
                      <label className={`button secondary sound-upload ${busy ? 'disabled' : ''}`}>
                        <Upload size={16} />
                        <span>Выбрать</span>
                        <input
                          aria-label={`Звук: ${label}`}
                          type="file"
                          accept={
                            platform === 'ios'
                              ? '.wav,.caf,.aif,.aiff'
                              : '.wav,.mp3,.ogg,.m4a,.caf,.aif,.aiff'
                          }
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) void changeSound(kind, file);
                          }}
                        />
                      </label>
                      <button
                        className="icon-button"
                        disabled={busy || !preferences.sounds[kind]}
                        aria-label={`Сбросить звук: ${label}`}
                        onClick={() => void changeSound(kind)}
                      >
                        <RotateCcw size={17} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="setting-footnote">
                Звуки хранятся на этом устройстве. До 2 МБ и 30 секунд; для iPhone — WAV, CAF или
                AIFF.
              </p>
            </>
          ) : (
            <p className="native-note">
              Выбор звуков доступен в приложениях Windows, Android и iOS.
            </p>
          )}
        </section>
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <CalendarDays />
            <div>
              <h2>Рабочий стол и уведомления</h2>
              <p className="muted">Быстрый доступ к встречам и приглашениям.</p>
            </div>
          </div>
          {desktop && (
            <>
              <div className="setting-row">
                <div>
                  <strong>Виджет календаря на рабочем столе</strong>
                  <p className="muted">
                    Даты со встречами выделены. Нажмите на дату, чтобы открыть встречу или
                    приглашение.
                  </p>
                </div>
                <Toggle
                  label="Виджет календаря на рабочем столе"
                  value={preferences.widgetEnabled}
                  onChange={() =>
                    setPreferences({ ...preferences, widgetEnabled: !preferences.widgetEnabled })
                  }
                />
              </div>
              <div className="setting-row">
                <span>Запускать при входе в Windows</span>
                <Toggle
                  label="Запускать при входе в Windows"
                  value={autoStart}
                  onChange={() => {
                    void window
                      .partyup!.setAutoStart(!autoStart)
                      .then(() => {
                        localStorage.setItem('partyup.autostart', String(!autoStart));
                        setAutoStart(!autoStart);
                      })
                      .catch(report);
                  }}
                />
              </div>
              <p className="setting-footnote">
                Счётчик непрочитанных уведомлений отображается на значке в трее. При закрытии окна
                приложение продолжает работать.
              </p>
            </>
          )}
          {mobile && (
            <>
              <div className="setting-row">
                <span>Мобильные push</span>
                <Toggle
                  label="Мобильные push"
                  value={pushEnabled}
                  disabled={busy || !data.pushConfigured}
                  onChange={() => {
                    setBusy(true);
                    void (
                      pushEnabled
                        ? disablePush()
                        : enablePush(() => void refresh(), onOpen, data.user.id)
                    )
                      .then(() => {
                        localStorage.setItem('partyup.push', String(!pushEnabled));
                        setPushEnabled(!pushEnabled);
                        toast(pushEnabled ? 'Push отключены' : 'Push подключены');
                      })
                      .catch(report)
                      .finally(() => setBusy(false));
                  }}
                />
              </div>
              {!data.pushConfigured && (
                <p className="setting-footnote">
                  Для push нужно подключить Firebase на сервере и в мобильной сборке.
                </p>
              )}
            </>
          )}
          {!desktop && !mobile && (
            <p className="native-note">Виджет и счётчик в трее доступны в приложении Windows.</p>
          )}
        </section>
        <section className="panel settings-section">
          <div className="settings-section-heading">
            <ShieldCheck />
            <div>
              <h2>Ваше пространство</h2>
              <p className="muted">Встречи доступны организатору и приглашённым участникам.</p>
            </div>
          </div>
          <div className="server-address">
            <span>Общий сервер</span>
            <code>{serverUrl()}</code>
          </div>
          {serverUrl().startsWith('http://') && (
            <p className="transport-notice">Подключение по HTTP без шифрования.</p>
          )}
          <button className="button secondary" onClick={onLogout}>
            <Globe2 size={17} /> Сменить сервер
          </button>
          <p className="setting-footnote">
            Смена сервера завершает сессию на этом устройстве и доступна без подключения.
          </p>
        </section>
      </div>
    </>
  );
}
