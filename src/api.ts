import { Capacitor, registerPlugin } from '@capacitor/core';
export const mobile = Capacitor.isNativePlatform();
export const desktop = Boolean(window.partyup);
export const platform = mobile ? Capacitor.getPlatform() : desktop ? 'windows' : 'preview';
export const native = registerPlugin<{
  getToken(): Promise<{ value?: string }>;
  setToken(options: { value: string }): Promise<void>;
  clearToken(): Promise<void>;
  saveCalendar(options: {
    key: string;
    title: string;
    startMs: number;
    endMs: number;
    notes: string;
    location: string;
  }): Promise<void>;
  removeCalendar(options: { key: string }): Promise<void>;
}>('PartyNative');
let token = '';
let sessionVersion = 0;
const requests = new Set<AbortController>();
export class SessionChangedError extends Error {
  constructor() {
    super('Сессия завершена или изменена');
  }
}
export const getSessionVersion = () => sessionVersion;
function invalidateRequests() {
  sessionVersion++;
  for (const request of requests) request.abort();
  requests.clear();
}
export function serverUrl() {
  return localStorage.getItem('partyup.server') || (mobile ? '' : 'http://127.0.0.1:3001');
}
export function setServerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Укажите полный адрес сервера, например https://party.example.com');
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))
  )
    throw new Error('Для удалённого сервера нужен HTTPS');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Укажите адрес без пути, пароля и параметров');
  localStorage.setItem('partyup.server', url.origin);
}
export async function loadToken() {
  const version = sessionVersion;
  if (localStorage.getItem('partyup.loggedOut') === 'true') return (token = '');
  const stored = mobile
    ? (await native.getToken())?.value || ''
    : desktop
      ? (await window.partyup!.getToken()) || ''
      : sessionStorage.getItem('partyup.token') || '';
  if (version !== sessionVersion || localStorage.getItem('partyup.loggedOut') === 'true') return '';
  try {
    const value = JSON.parse(stored || '{}');
    token = value.origin === serverUrl() && typeof value.token === 'string' ? value.token : '';
  } catch {
    token = '';
  }
  return token;
}
export async function saveToken(value: string) {
  const stored = JSON.stringify({ origin: serverUrl(), token: value });
  if (mobile) await native.setToken({ value: stored });
  else if (desktop) await window.partyup!.setToken(stored);
  else sessionStorage.setItem('partyup.token', stored);
  localStorage.removeItem('partyup.loggedOut');
  invalidateRequests();
  token = value;
  window.partyup?.connect({ origin: serverUrl(), token });
}
export async function clearToken() {
  token = '';
  invalidateRequests();
  // A local tombstone also prevents restoring a session if native storage cleanup fails.
  localStorage.setItem('partyup.loggedOut', 'true');
  window.partyup?.disconnect();
  if (mobile) await native.clearToken();
  else if (desktop) await window.partyup!.clearToken();
  else sessionStorage.removeItem('partyup.token');
}
export function connectDesktop() {
  if (token) window.partyup?.connect({ origin: serverUrl(), token });
}
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
// Snapshot credentials before local logout; this request must never follow a server switch.
// It deliberately stays outside the requests cancelled by clearToken().
export async function revokeSession(deviceToken?: string) {
  const origin = serverUrl();
  const credential = token;
  if (!origin || !credential) return;
  await fetch(origin + '/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken }),
    signal: AbortSignal.timeout(3000),
  });
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (!serverUrl()) throw new Error('Сначала укажите адрес вашего сервера');
  const version = sessionVersion;
  const controller = new AbortController();
  requests.add(controller);
  try {
    const response = await fetch(serverUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    const data = await response.json();
    if (version !== sessionVersion) throw new SessionChangedError();
    if (!response.ok) throw new ApiError(data.error || 'Ошибка запроса', response.status);
    return data;
  } catch (error) {
    if (version !== sessionVersion) throw new SessionChangedError();
    if (error instanceof ApiError) throw error;
    throw new Error('Нет связи с сервером. Проверьте адрес и подключение.');
  } finally {
    requests.delete(controller);
  }
}
export async function downloadCalendar(id: string) {
  const response = await fetch(`${serverUrl()}/api/events/${id}/calendar`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Не удалось получить событие календаря');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'partyup.ics';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
