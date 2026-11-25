export type Person = {
  id: string;
  name: string;
  username?: string;
  color: string;
  friend_code?: string;
  avatar?: string;
};
export type Participant = Person & { status: 'accepted' | 'pending' | 'declined' };
export type GameEvent = {
  id: string;
  host_id: string;
  host_name: string;
  title: string;
  game: string;
  steam_app_id?: number | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  notes: string;
  location: string;
  cancelled: number;
  version: number;
  created_at: string;
  my_status: Participant['status'];
  participants: Participant[];
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  event_id: string | null;
  is_read: number;
  kind: string;
  created_at: string;
};
export type AppState = {
  user: Person;
  friends: Person[];
  requests: (Person & { sender_id: string; recipient_id: string })[];
  events: GameEvent[];
  notifications: Notice[];
  unreadCount: number;
  pushConfigured: boolean;
  demo: boolean;
  preferences: { alarmEnabled: boolean; alarmMinutes: number };
};
export type SoundKind =
  'invite' | 'reply' | 'decline' | 'message' | 'friend' | 'cancel' | 'reminder';
export type SoundChoice = { name: string; channelId?: string; soundName?: string };
export type DevicePreferences = {
  theme: 'forest' | 'ocean' | 'violet' | 'light';
  widgetEnabled: boolean;
  hideInactive: boolean;
  zoom: number;
  sounds: Partial<Record<SoundKind, SoundChoice>>;
};
export type WidgetState = {
  events: GameEvent[];
  zone: string;
  theme: DevicePreferences['theme'];
  connected: boolean;
};
export type Message = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  avatar?: string;
  text: string;
  created_at: string;
};
export type NativeAPI = {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  notify(data: { title: string; body: string; eventId?: string }): void;
  connect(data: { origin: string; token: string }): void;
  disconnect(): void;
  onOpen(callback: (id: string) => void): () => void;
  setAutoStart(enabled: boolean): Promise<void>;
  configure(data: { scope: string; zone: string; preferences: DevicePreferences }): Promise<void>;
  setSound(
    data: { kind: SoundKind; name: string; dataUrl: string } | { kind: SoundKind; reset: true },
  ): Promise<SoundChoice | null>;
  previewSound(kind: SoundKind): Promise<void>;
  onPreferences(callback: (value: DevicePreferences) => void): () => void;
};
declare global {
  interface Window {
    partyup?: NativeAPI;
    partyupWidget?: {
      getState(): Promise<WidgetState>;
      onState(callback: (state: WidgetState) => void): () => void;
      openEvent(id: string): void;
      hide(): void;
    };
  }
}
