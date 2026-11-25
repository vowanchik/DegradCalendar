import { serverUrl } from './api.ts';
import type { DevicePreferences, SoundKind } from './types';

export const soundKinds: [SoundKind, string][] = [
  ['invite', 'Приглашения'],
  ['reply', 'Подтверждения участия'],
  ['decline', 'Отказы участников'],
  ['message', 'Сообщения'],
  ['friend', 'Заявки в друзья'],
  ['cancel', 'Отмена встречи'],
  ['reminder', 'Будильник'],
];
export const preferenceScope = (userId: string) => `${serverUrl()}:${userId}`;
export function loadPreferences(scope: string): DevicePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(`partyup.preferences:${scope}`) || '{}');
    return {
      theme: ['forest', 'ocean', 'violet', 'light'].includes(value.theme) ? value.theme : 'forest',
      widgetEnabled: value.widgetEnabled === true,
      sounds: value.sounds || {},
    };
  } catch {
    return { theme: 'forest', widgetEnabled: false, sounds: {} };
  }
}
export function savePreferences(scope: string, value: DevicePreferences) {
  localStorage.setItem(`partyup.preferences:${scope}`, JSON.stringify(value));
}
