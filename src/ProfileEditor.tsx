import { useRef, useState, type FormEvent } from 'react';
import { api, getSessionVersion } from './api';
import type { Person } from './types';

async function resizeAvatar(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Выберите PNG, JPEG или WebP до 10 МБ');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 160;
    const context = canvas.getContext('2d')!;
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      160,
      160,
    );
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}
export function ProfileEditor({
  user,
  refresh,
  toast,
}: {
  user: Person;
  refresh(): Promise<void>;
  toast(message: string): void;
}) {
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selection = useRef(0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword && newPassword !== confirmation) {
      setError('Новые пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      await api('/api/profile', {
        name,
        avatar,
        ...(newPassword ? { currentPassword, newPassword } : {}),
      });
      await refresh();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      toast(newPassword ? 'Профиль сохранён. Другие сеансы входа завершены.' : 'Профиль сохранён');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить профиль');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-section">
      <h2>Редактировать профиль</h2>
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-avatar-controls">
          <span className="avatar" style={{ '--avatar': user.color } as React.CSSProperties}>
            {avatar ? <img src={avatar} alt="Ваша аватарка" /> : name.slice(0, 1)}
          </span>
          <label className="button secondary upload-button">
            Выбрать аватарку
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const version = getSessionVersion(),
                  choice = ++selection.current;
                setBusy(true);
                setError('');
                void resizeAvatar(file)
                  .then((image) => {
                    if (version === getSessionVersion() && choice === selection.current)
                      setAvatar(image);
                  })
                  .catch((error: unknown) =>
                    setError(
                      error instanceof Error ? error.message : 'Не удалось открыть изображение',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            />
          </label>
          <button
            type="button"
            className="text-button"
            disabled={busy || !avatar}
            onClick={() => {
              selection.current++;
              setAvatar('');
            }}
          >
            Удалить
          </button>
        </div>
        <label>
          Имя
          <input
            value={name}
            required
            minLength={2}
            maxLength={32}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <details>
          <summary>Изменить пароль</summary>
          <div className="password-fields">
            <p className="field-hint">После смены пароля другие сеансы входа будут завершены.</p>
            <label>
              Текущий пароль
              <input
                type="password"
                autoComplete="current-password"
                minLength={8}
                maxLength={128}
                required={Boolean(newPassword)}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              Новый пароль
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Повторите новый пароль
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required={Boolean(newPassword)}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </div>
        </details>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить профиль'}
        </button>
      </form>
    </section>
  );
}
