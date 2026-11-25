import { registerPlugin } from '@capacitor/core';
import type { FirebaseMessagingPlugin } from '@capacitor-firebase/messaging';
import { api, mobile, platform, revokeSession, getSessionVersion } from './api.ts';
import { loadPreferences, preferenceScope } from './preferences.ts';
// Native targets use the installed native plugin, with no browser Firebase SDK.
export const FirebaseMessaging = registerPlugin<FirebaseMessagingPlugin>('FirebaseMessaging');
let pushToken: string | undefined;
let pushUserId: string | undefined;
let handles: { remove(): Promise<void> }[] = [];
let pushVersion = 0;
let tokenCleanup: Promise<unknown> = Promise.resolve();
export async function enablePush(
  onChange: () => void,
  onOpen: (id: string) => void,
  userId: string,
) {
  if (!mobile) return;
  const stopping = stopPush();
  const version = pushVersion;
  const session = getSessionVersion();
  const active = () => version === pushVersion && session === getSessionVersion();
  await stopping;
  await tokenCleanup;
  if (!active()) return;
  const permission = await FirebaseMessaging.requestPermissions();
  if (!active()) return;
  if (permission.receive !== 'granted')
    throw new Error('Уведомления запрещены. Разрешите их в настройках телефона.');
  if (platform === 'android')
    await FirebaseMessaging.createChannel({
      id: 'partyup',
      name: 'Игровые встречи',
      importance: 4,
    });
  if (!active()) return;
  const register = async (token: string) => {
    if (!active()) return;
    await api('/api/devices', {
      token,
      platform,
      sounds: loadPreferences(preferenceScope(userId)).sounds,
    });
    if (active()) {
      pushToken = token;
      pushUserId = userId;
    }
  };
  const remember = async (pending: Promise<{ remove(): Promise<void> }>) => {
    const handle = await pending;
    if (active()) handles.push(handle);
    else await handle.remove();
  };
  await remember(
    FirebaseMessaging.addListener('tokenReceived', (event) => {
      void register(event.token).catch(console.error);
    }),
  );
  if (!active()) return;
  await remember(
    FirebaseMessaging.addListener('notificationReceived', () => {
      if (active()) onChange();
    }),
  );
  if (!active()) return;
  await remember(
    FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      if (!active()) return;
      const id = (event.notification.data as Record<string, unknown> | undefined)?.eventId;
      if (typeof id === 'string' && id) onOpen(id);
      onChange();
    }),
  );
  if (!active()) return;
  await register((await FirebaseMessaging.getToken()).token);
}
export async function stopPush() {
  pushVersion++;
  const previous = handles;
  handles = [];
  await Promise.allSettled(previous.map((h) => h.remove()));
}
export function logoutPush() {
  // Neither server availability nor Firebase cleanup may block local logout.
  void revokeSession(pushToken).catch(() => {});
  void stopPush();
  pushToken = undefined;
  pushUserId = undefined;
  if (mobile) tokenCleanup = FirebaseMessaging.deleteToken().catch(() => {});
}
export async function syncPushSounds() {
  if (pushToken && pushUserId)
    await api('/api/devices', {
      token: pushToken,
      platform,
      sounds: loadPreferences(preferenceScope(pushUserId)).sounds,
    });
}
export async function disablePush() {
  if (pushToken) await api('/api/devices/remove', { token: pushToken });
  await stopPush();
  await FirebaseMessaging.deleteToken();
  pushToken = undefined;
  pushUserId = undefined;
}
