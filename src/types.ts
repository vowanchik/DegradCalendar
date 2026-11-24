export type Person = {
  id: string;
  name: string;
  username?: string;
  color: string;
  friend_code?: string;
};
export type Participant = Person & { status: 'accepted' | 'pending' | 'declined' };
export type GameEvent = {
  id: string;
  host_id: string;
  host_name: string;
  title: string;
  game: string;
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
  pushConfigured: boolean;
  demo: boolean;
};
export type Message = {
  id: string;
  user_id: string;
  name: string;
  color: string;
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
};
declare global {
  interface Window {
    partyup?: NativeAPI;
  }
}
