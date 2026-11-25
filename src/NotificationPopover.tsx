import { Bell, CheckCheck, MessageCircle, Users, X, CircleX, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { formatDate, formatTime } from './time';
import type { Notice } from './types';

export function NotificationPopover({
  notices,
  unreadCount,
  zone,
  onClose,
  onRead,
  onOpen,
  toast,
}: {
  notices: Notice[];
  unreadCount: number;
  zone: string;
  onClose(): void;
  onRead(): Promise<void>;
  onOpen(id: string | null): void;
  toast(message: string): void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = unreadCount;
  useEffect(() => {
    ref.current?.focus();
  }, []);
  async function read(id?: string) {
    setBusy(true);
    try {
      await api('/api/notifications/read', id ? { id } : {});
      await onRead();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось прочитать уведомление');
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      await api('/api/notifications/clear', {});
      await onRead();
      setConfirmClear(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось очистить уведомления');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="notification-popover"
      role="dialog"
      aria-label="Уведомления"
      tabIndex={-1}
      ref={ref}
    >
      <div className="popover-heading">
        <h2>
          Уведомления <span className="count-label">{unread}</span>
        </h2>
        <button className="icon-button" aria-label="Закрыть уведомления" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="notice-top">
        <span className="muted">{unread ? `Непрочитанных: ${unread}` : 'Вы всё прочитали'}</span>
        <button className="text-button" disabled={!unread || busy} onClick={() => void read()}>
          <CheckCheck size={16} /> Прочитать все
        </button>
      </div>
      {notices.length > 0 && (
        <div className="notice-clear">
          {confirmClear ? (
            <>
              <span>Удалить все уведомления?</span>
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => void clear()}
              >
                Удалить все
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setConfirmClear(false)}
              >
                Отмена
              </button>
            </>
          ) : (
            <button className="text-button" disabled={busy} onClick={() => setConfirmClear(true)}>
              <Trash2 size={16} /> Очистить список
            </button>
          )}
        </div>
      )}
      <div className="notices">
        {notices.length ? (
          notices.map((n) => (
            <button
              key={n.id}
              disabled={busy}
              className={`notice ${!n.is_read ? 'unread' : ''} ${n.kind === 'decline' ? 'notice-decline' : ''}`}
              onClick={() => {
                if (!n.is_read) void read(n.id);
                onOpen(n.event_id);
              }}
            >
              <span className="notice-icon">
                {n.kind === 'message' ? (
                  <MessageCircle size={18} />
                ) : n.kind === 'friend' ? (
                  <Users size={18} />
                ) : n.kind === 'decline' ? (
                  <CircleX size={18} />
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
            <p>Здесь появятся приглашения, ответы и напоминания.</p>
          </div>
        )}
      </div>
    </div>
  );
}
