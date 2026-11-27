import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createStore } from './store.mjs';
import { createSteamSearch } from './steam.mjs';
const derive = promisify(scrypt);
const iso = () => new Date().toISOString();
const hash = (token) => createHash('sha256').update(token).digest('hex');
const colors = ['#b8f56b', '#c4a6ff', '#ffb580', '#86c8ff', '#ff93b3'];
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [salt, key] = stored.split(':');
  return timingSafeEqual(Buffer.from(key, 'hex'), await derive(password, salt, 64));
}
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function text(value, label, min = 1, max = 100) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    fail(400, `${label}: от ${min} до ${max} символов`);
  return value.trim();
}
function timezone(value) {
  try {
    new Intl.DateTimeFormat('ru', { timeZone: value }).format();
  } catch {
    fail(400, 'Неизвестный часовой пояс');
  }
  return value;
}
function startTime(value) {
  const start = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (
    !Number.isFinite(start.getTime()) ||
    start.getTime() <= Date.now() ||
    start.getTime() > Date.now() + 366 * 86400000
  )
    fail(400, 'Выберите будущее время начала в пределах года');
  return start.toISOString();
}
function avatarImage(value) {
  if (value === '') return '';
  if (typeof value !== 'string') fail(400, 'Некорректная аватарка');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) fail(400, 'Выберите PNG, JPEG или WebP');
  const bytes = Buffer.from(match[2], 'base64');
  const signatures = {
    png: bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    jpeg: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    webp: bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  };
  if (bytes.length > 128 * 1024 || !signatures[match[1]] || bytes.toString('base64') !== match[2])
    fail(400, 'Некорректная аватарка или размер больше 128 КБ');
  return value;
}
export function createApplication({
  dataDir = './data',
  demo = false,
  appOrigin = '',
  push = null,
  steamSearch = createSteamSearch(),
} = {}) {
  const store = createStore(dataDir);
  const { get, all, run, transaction } = store;
  const live = new Map();
  const limits = new Map();
  let sending = false;
  function rate(key, max, ms = 60_000) {
    const now = Date.now();
    let item = limits.get(key);
    if (!item || item.until < now) {
      item = { count: 0, until: now + ms };
      limits.set(key, item);
    }
    if (++item.count > max) fail(429, 'Слишком много запросов. Попробуйте чуть позже.');
    if (limits.size > 5000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  }
  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      color: user.color,
      friend_code: user.friend_code,
      avatar: user.avatar,
    };
  }
  function notify(userId, title, body, eventId = null, kind = 'event') {
    const id = randomUUID();
    run(
      'INSERT INTO notifications(id,user_id,event_id,title,body,kind,created_at) VALUES(?,?,?,?,?,?,?)',
      id,
      userId,
      eventId,
      title,
      body,
      kind,
      iso(),
    );
    run('INSERT INTO push_outbox(id,notification_id) VALUES(?,?)', randomUUID(), id);
  }
  function invalidate(userIds) {
    for (const id of new Set(userIds))
      for (const response of live.get(id) || []) response.write('event: changed\ndata: {}\n\n');
  }
  function requireEvent(id, userId) {
    const event = get(
      'SELECT e.*,p.status my_status FROM events e JOIN participants p ON p.event_id=e.id WHERE e.id=? AND p.user_id=?',
      id,
      userId,
    );
    if (!event) fail(404, 'Встреча не найдена');
    return event;
  }
  const members = (id) =>
    all('SELECT user_id FROM participants WHERE event_id=?', id).map((p) => p.user_id);
  function state(userId) {
    const user = get('SELECT * FROM users WHERE id=?', userId);
    const friends = all(
      'SELECT u.id,u.username,u.name,u.color,u.avatar FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? ORDER BY u.name',
      userId,
    );
    const requests = all(
      'SELECT r.id,r.sender_id,r.recipient_id,u.name,u.username,u.color,u.avatar FROM friend_requests r JOIN users u ON u.id=CASE WHEN r.sender_id=? THEN r.recipient_id ELSE r.sender_id END WHERE r.sender_id=? OR r.recipient_id=?',
      userId,
      userId,
      userId,
    );
    const events = all(
      'SELECT e.*,p.status my_status,u.name host_name FROM events e JOIN participants p ON p.event_id=e.id JOIN users u ON u.id=e.host_id WHERE p.user_id=? ORDER BY e.starts_at',
      userId,
    );
    for (const event of events)
      event.participants = all(
        'SELECT u.id,u.name,u.color,u.avatar,p.status FROM participants p JOIN users u ON u.id=p.user_id WHERE p.event_id=?',
        event.id,
      );
    return {
      user: publicUser(user),
      friends,
      requests,
      events,
      notifications: all(
        'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
        userId,
      ),
      unreadCount: get(
        'SELECT COUNT(*) count FROM notifications WHERE user_id=? AND is_read=0',
        userId,
      ).count,
      pushConfigured: Boolean(push),
      demo,
      preferences: (() => {
        const prefs = get('SELECT * FROM preferences WHERE user_id=?', userId);
        return {
          alarmEnabled: prefs ? Boolean(prefs.alarm_enabled) : true,
          alarmMinutes: prefs?.alarm_minutes ?? 15,
        };
      })(),
    };
  }
  async function seed() {
    if (!demo || get("SELECT id FROM users WHERE username='demo'")) return;
    const pass = await passwordHash('partyup-demo');
    const ids = ['demo-user', 'demo-nikita', 'demo-anya', 'demo-max'];
    const names = ['Саша', 'Никита', 'Аня', 'Макс'];
    transaction(() => {
      ids.forEach((id, i) =>
        run(
          'INSERT INTO users(id,username,name,password,friend_code,color,created_at) VALUES(?,?,?,?,?,?,?)',
          id,
          ['demo', 'nikita', 'anya', 'max'][i],
          names[i],
          pass,
          `PLAY${i}DEMO`,
          colors[i],
          iso(),
        ),
      );
      for (const a of ids)
        for (const b of ids) if (a !== b) run('INSERT INTO friends VALUES(?,?)', a, b);
      const create = (offset, hour, title, game, host, statuses, notes) => {
        const start = new Date();
        start.setUTCDate(start.getUTCDate() + offset);
        start.setUTCHours(hour - 3, 0, 0, 0);
        if (start.getTime() <= Date.now()) start.setUTCDate(start.getUTCDate() + 1);
        const id = randomUUID();
        run(
          'INSERT INTO events(id,host_id,title,game,starts_at,ends_at,timezone,notes,location,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          id,
          ids[host],
          title,
          game,
          start.toISOString(),
          new Date(start.getTime() + 2 * 3600000).toISOString(),
          'Europe/Moscow',
          notes,
          'Discord · общий голосовой',
          iso(),
        );
        ids.forEach((uid, i) =>
          run('INSERT INTO participants VALUES(?,?,?)', id, uid, statuses[i]),
        );
        run(
          'INSERT INTO messages VALUES(?,?,?,?,?)',
          randomUUID(),
          id,
          ids[host],
          'Собираемся без спешки. Кто будет — отмечайтесь здесь ✌️',
          iso(),
        );
        return id;
      };
      create(
        1,
        20,
        'Вечер хороших каток',
        'Counter-Strike 2',
        0,
        ['accepted', 'accepted', 'pending', 'accepted'],
        'Пара матчей в Premier. Настроение важнее рейтинга.',
      );
      const incoming = create(
        2,
        21,
        'За демократию!',
        'Helldivers 2',
        1,
        ['pending', 'accepted', 'accepted', 'pending'],
        'Берите любимые стратагемы. Уровень сложности выберем вместе.',
      );
      create(
        4,
        19,
        'Строим наш мир',
        'Minecraft',
        2,
        ['accepted', 'accepted', 'accepted', 'pending'],
        'Продолжаем базу, исследуем пещеры и просто болтаем.',
      );
      notify(
        ids[0],
        'Никита зовёт играть',
        'Helldivers 2 · ответьте на приглашение',
        incoming,
        'invite',
      );
    });
  }
  async function flushPush() {
    if (sending || !push) return;
    sending = true;
    try {
      for (const row of all(
        'SELECT o.*,n.user_id,n.title,n.body,n.event_id,n.kind FROM push_outbox o JOIN notifications n ON n.id=o.notification_id WHERE o.next_attempt<=? LIMIT 50',
        Date.now(),
      )) {
        if (row.kind === 'reminder') {
          const current = get(
            'SELECT e.cancelled,e.starts_at,p.status FROM events e JOIN participants p ON p.event_id=e.id WHERE e.id=? AND p.user_id=?',
            row.event_id,
            row.user_id,
          );
          const pref = get('SELECT alarm_enabled FROM preferences WHERE user_id=?', row.user_id);
          const unconfirmed = get(
            "SELECT 1 FROM participants WHERE event_id=? AND status<>'accepted' LIMIT 1",
            row.event_id,
          );
          if (
            !current ||
            current.cancelled ||
            current.status !== 'accepted' ||
            unconfirmed ||
            Date.parse(current.starts_at) <= Date.now() ||
            pref?.alarm_enabled === 0
          ) {
            run('DELETE FROM push_outbox WHERE id=?', row.id);
            continue;
          }
        }
        const tokens = all('SELECT token FROM devices WHERE user_id=?', row.user_id).map(
          (d) => d.token,
        );
        if (!tokens.length) {
          run('DELETE FROM push_outbox WHERE id=?', row.id);
          continue;
        }
        try {
          const dead = await push(tokens, {
            title: row.title,
            body: row.body,
            eventId: row.event_id || '',
            notificationId: row.notification_id,
            kind: row.kind,
            deviceSounds: Object.fromEntries(
              tokens.map((token) => [
                token,
                JSON.parse(
                  get('SELECT sounds FROM device_sounds WHERE token=?', token)?.sounds || '{}',
                ),
              ]),
            ),
          });
          for (const token of dead || []) run('DELETE FROM devices WHERE token=?', token);
          run('DELETE FROM push_outbox WHERE id=?', row.id);
        } catch (error) {
          console.error('Push delivery failed:', error.code || error.message);
          if (row.attempts >= 7) run('DELETE FROM push_outbox WHERE id=?', row.id);
          else
            run(
              'UPDATE push_outbox SET attempts=attempts+1,next_attempt=? WHERE id=?',
              Date.now() + Math.min(3600000, 10000 * 2 ** row.attempts),
              row.id,
            );
        }
      }
    } finally {
      sending = false;
    }
  }
  function remind() {
    const now = Date.now();
    const changed = [];
    transaction(() => {
      for (const event of all(
        `SELECT e.*,p.user_id FROM events e JOIN participants p ON p.event_id=e.id
         LEFT JOIN preferences pref ON pref.user_id=p.user_id
         WHERE e.cancelled=0 AND p.status=? AND COALESCE(pref.alarm_enabled,1)=1
         AND NOT EXISTS (SELECT 1 FROM participants team WHERE team.event_id=e.id AND team.status<>'accepted')
         AND e.starts_at>? AND julianday(e.starts_at)<=julianday(?) + COALESCE(pref.alarm_minutes,15)/1440.0`,
        'accepted',
        new Date(now).toISOString(),
        new Date(now).toISOString(),
      )) {
        if (
          get(
            'SELECT 1 FROM reminders WHERE event_id=? AND user_id=? AND version=?',
            event.id,
            event.user_id,
            event.version,
          )
        )
          continue;
        run('INSERT INTO reminders VALUES(?,?,?)', event.id, event.user_id, event.version);
        notify(
          event.user_id,
          'Скоро собираемся!',
          `${event.game} · начало через ${Math.max(1, Math.ceil((Date.parse(event.starts_at) - now) / 60000))} мин.`,
          event.id,
          'reminder',
        );
        changed.push(event.user_id);
      }
      run('DELETE FROM sessions WHERE expires_at<?', now);
      run(
        'DELETE FROM push_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE created_at<?)',
        new Date(now - 7 * 86400000).toISOString(),
      );
    });
    invalidate(changed);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    const allowed = new Set([
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'capacitor://localhost',
      'http://localhost',
      'https://localhost',
      'null',
      ...(appOrigin ? [appOrigin] : []),
    ]);
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/api/health')
        return send(200, { ok: true, app: 'PartyUp', demo, pushConfigured: Boolean(push) });
      rate(`ip:${req.socket.remoteAddress}`, 600);
      let body = {};
      if (req.method === 'POST') {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > (path === '/api/profile' ? 200000 : 32768))
            fail(413, 'Слишком большой запрос');
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks).toString('utf8');
        try {
          body = data ? JSON.parse(data) : {};
        } catch {
          fail(400, 'Некорректный JSON');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          fail(400, 'Некорректный запрос');
      }
      if (
        req.method === 'POST' &&
        ['/api/auth/register', '/api/auth/login', '/api/auth/demo'].includes(path)
      ) {
        rate(`auth:${req.socket.remoteAddress}`, 20);
        if (path === '/api/auth/demo' && !demo) fail(404, 'Демо отключено');
        const username =
          path === '/api/auth/demo' ? 'demo' : text(body.username, 'Логин', 3, 32).toLowerCase();
        const password =
          path === '/api/auth/demo' ? 'partyup-demo' : text(body.password, 'Пароль', 8, 128);
        if (!/^[a-z0-9_.-]+$/.test(username))
          fail(400, 'Логин: латинские буквы, цифры, точка, дефис');
        let user = get('SELECT * FROM users WHERE username=?', username);
        if (path.endsWith('/register')) {
          if (user) fail(409, 'Этот логин уже занят');
          const name = text(body.name, 'Имя', 2, 32);
          const passwordValue = await passwordHash(password);
          // Recheck after the async password derivation to handle concurrent registrations.
          if (get('SELECT id FROM users WHERE username=?', username))
            fail(409, 'Этот логин уже занят');
          const id = randomUUID();
          run(
            'INSERT INTO users(id,username,name,password,friend_code,color,created_at) VALUES(?,?,?,?,?,?,?)',
            id,
            username,
            name,
            passwordValue,
            randomBytes(5).toString('hex').toUpperCase(),
            colors[Math.floor(Math.random() * colors.length)],
            iso(),
          );
          user = get('SELECT * FROM users WHERE id=?', id);
        } else {
          const match = await passwordMatches(
            password,
            user?.password || '00000000000000000000000000000000:' + '00'.repeat(64),
          );
          if (
            !user ||
            !match ||
            get('SELECT password FROM users WHERE id=?', user.id)?.password !== user.password
          )
            fail(401, 'Неверный логин или пароль');
        }
        const token = randomBytes(32).toString('base64url');
        run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, Date.now() + 30 * 86400000);
        return send(200, { token, user: publicUser(user) });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const session =
        token &&
        get('SELECT * FROM sessions WHERE hash=? AND expires_at>?', hash(token), Date.now());
      if (!session) fail(401, 'Войдите в аккаунт');
      const uid = session.user_id;
      if (req.method === 'GET' && path === '/api/live') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('event: ready\ndata: {}\n\n');
        if (!live.has(uid)) live.set(uid, new Set());
        if (live.get(uid).size >= 8) {
          res.end();
          return;
        }
        live.get(uid).add(res);
        const heartbeat = setInterval(() => {
          if (
            !get('SELECT 1 FROM sessions WHERE hash=? AND expires_at>?', session.hash, Date.now())
          ) {
            res.end();
            return;
          }
          res.write(': heartbeat\n\n');
        }, 20000);
        res.on('close', () => {
          clearInterval(heartbeat);
          live.get(uid)?.delete(res);
          if (!live.get(uid)?.size) live.delete(uid);
        });
        return;
      }
      if (req.method === 'GET' && path === '/api/state') return send(200, state(uid));
      if (req.method === 'GET' && path === '/api/steam/search') {
        rate(`steam:${uid}`, 60);
        const query = text(url.searchParams.get('q'), 'Поиск игры', 2, 100);
        try {
          return send(200, await steamSearch(query));
        } catch {
          fail(502, 'Steam сейчас недоступен. Попробуйте позже или введите игру вручную.');
        }
      }
      if (req.method === 'POST' && path === '/api/profile') {
        rate(`profile:${uid}`, 15);
        const user = get('SELECT * FROM users WHERE id=?', uid);
        const name = text(body.name, 'Имя', 2, 32);
        const avatar = body.avatar === undefined ? user.avatar : avatarImage(body.avatar);
        let password = user.password;
        if (body.newPassword !== undefined) {
          const currentPassword = text(body.currentPassword, 'Текущий пароль', 8, 128);
          const next = text(body.newPassword, 'Новый пароль', 8, 128);
          if (!(await passwordMatches(currentPassword, user.password)))
            fail(403, 'Неверный текущий пароль');
          password = await passwordHash(next);
        }
        transaction(() => {
          if (
            get('SELECT password FROM users WHERE id=?', uid).password !== user.password ||
            !get('SELECT 1 FROM sessions WHERE hash=?', session.hash)
          )
            fail(409, 'Профиль уже изменён. Обновите страницу и повторите.');
          run(
            'UPDATE users SET name=?,avatar=?,password=? WHERE id=?',
            name,
            avatar,
            password,
            uid,
          );
          if (body.newPassword !== undefined)
            run('DELETE FROM sessions WHERE user_id=? AND hash<>?', uid, session.hash);
        });
        invalidate([
          uid,
          ...all('SELECT user_id FROM friends WHERE friend_id=?', uid).map((r) => r.user_id),
        ]);
        return send(200, { user: publicUser(get('SELECT * FROM users WHERE id=?', uid)) });
      }
      if (req.method === 'POST' && path === '/api/preferences') {
        if (
          typeof body.alarmEnabled !== 'boolean' ||
          !Number.isInteger(body.alarmMinutes) ||
          body.alarmMinutes < 1 ||
          body.alarmMinutes > 10080
        )
          fail(400, 'Укажите включение будильника и время от 1 до 10080 минут');
        run(
          'INSERT INTO preferences(user_id,alarm_enabled,alarm_minutes) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET alarm_enabled=excluded.alarm_enabled,alarm_minutes=excluded.alarm_minutes',
          uid,
          Number(body.alarmEnabled),
          body.alarmMinutes,
        );
        if (!body.alarmEnabled)
          run(
            "DELETE FROM push_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE user_id=? AND kind='reminder')",
            uid,
          );
        invalidate([uid]);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        transaction(() => {
          run('DELETE FROM sessions WHERE hash=?', hash(token));
          if (typeof body.deviceToken === 'string')
            run('DELETE FROM devices WHERE token=? AND user_id=?', body.deviceToken, uid);
        });
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/friends') {
        rate(`friends:${uid}`, 15);
        const code = text(body.code, 'Код друга', 6, 32).toUpperCase();
        const target = get('SELECT * FROM users WHERE friend_code=?', code);
        if (!target) fail(404, 'Пользователь с таким кодом не найден');
        if (target.id === uid) fail(400, 'Это ваш код :)');
        if (get('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?', uid, target.id))
          fail(409, 'Вы уже друзья');
        if (
          get(
            'SELECT 1 FROM friend_requests WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)',
            uid,
            target.id,
            target.id,
            uid,
          )
        )
          fail(409, 'Запрос уже есть. Проверьте входящие заявки.');
        transaction(() => {
          run('INSERT INTO friend_requests VALUES(?,?,?,?)', randomUUID(), uid, target.id, iso());
          notify(
            target.id,
            'Новый запрос в друзья',
            `${get('SELECT name FROM users WHERE id=?', uid).name} хочет добавить вас`,
            null,
            'friend',
          );
        });
        invalidate([uid, target.id]);
        return send(201, { ok: true });
      }
      let match = path.match(/^\/api\/friends\/requests\/([^/]+)$/);
      if (req.method === 'POST' && match) {
        const request = get(
          'SELECT * FROM friend_requests WHERE id=? AND recipient_id=?',
          match[1],
          uid,
        );
        if (!request) fail(404, 'Запрос не найден');
        if (typeof body.accept !== 'boolean') fail(400, 'Укажите ответ');
        transaction(() => {
          if (body.accept) {
            run('INSERT OR IGNORE INTO friends VALUES(?,?)', uid, request.sender_id);
            run('INSERT OR IGNORE INTO friends VALUES(?,?)', request.sender_id, uid);
            notify(
              request.sender_id,
              'Теперь вы друзья!',
              `${get('SELECT name FROM users WHERE id=?', uid).name} принял(а) заявку`,
              null,
              'friend',
            );
          }
          run('DELETE FROM friend_requests WHERE id=?', request.id);
        });
        invalidate([uid, request.sender_id]);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/events') {
        rate(`event:${uid}`, 20);
        const game = text(body.game, 'Игра', 2, 200);
        const title = body.title ? text(body.title, 'Название', 2, 200) : game;
        const start = startTime(body.starts_at);
        const steamId = body.steam_app_id ?? null;
        if (steamId !== null && (!Number.isInteger(steamId) || steamId < 1 || steamId > 2147483647))
          fail(400, 'Некорректная игра Steam');
        const tz = timezone(text(body.timezone, 'Часовой пояс', 1, 80));
        const notes = body.notes ? text(body.notes, 'Описание', 1, 1000) : '';
        const location = body.location ? text(body.location, 'Где играем', 1, 120) : 'Онлайн';
        if (!Array.isArray(body.friends) || !body.friends.length || body.friends.length > 30)
          fail(400, 'Выберите от 1 до 30 друзей');
        const guests = [...new Set(body.friends)];
        for (const friend of guests)
          if (
            typeof friend !== 'string' ||
            !get('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?', uid, friend)
          )
            fail(400, 'Можно приглашать только своих друзей');
        const id = randomUUID();
        transaction(() => {
          run(
            'INSERT INTO events(id,host_id,title,game,starts_at,ends_at,timezone,notes,location,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
            id,
            uid,
            title,
            game,
            start,
            start,
            tz,
            notes,
            location,
            iso(),
          );
          run('UPDATE events SET steam_app_id=? WHERE id=?', steamId, id);
          run('INSERT INTO participants VALUES(?,?,?)', id, uid, 'accepted');
          for (const friend of guests) {
            run('INSERT INTO participants VALUES(?,?,?)', id, friend, 'pending');
            notify(
              friend,
              `${get('SELECT name FROM users WHERE id=?', uid).name} зовёт играть`,
              `${game} · ${title}`,
              id,
              'invite',
            );
          }
        });
        invalidate([uid, ...guests]);
        return send(201, { id });
      }
      match = path.match(/^\/api\/events\/([^/]+)\/(reply|cancel|messages|reschedule)$/);
      if (match) {
        const event = requireEvent(match[1], uid);
        const action = match[2];
        const userIds = members(event.id);
        if (req.method === 'POST' && action === 'reschedule') {
          if (event.host_id !== uid) fail(403, 'Только организатор может перенести встречу');
          if (event.cancelled) fail(409, 'Встреча отменена');
          if (!Number.isInteger(body.version) || body.version !== event.version)
            fail(409, 'Встреча уже изменена. Обновите данные и повторите.');
          const start = startTime(body.starts_at);
          const tz = timezone(text(body.timezone, 'Часовой пояс', 1, 80));
          if (start !== event.starts_at || tz !== event.timezone)
            transaction(() => {
              run(
                'UPDATE events SET starts_at=?,ends_at=?,timezone=?,version=version+1 WHERE id=?',
                start,
                start,
                tz,
                event.id,
              );
              run(
                "UPDATE participants SET status='pending' WHERE event_id=? AND user_id<>?",
                event.id,
                uid,
              );
              run(
                "DELETE FROM push_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE event_id=? AND kind IN ('reminder','invite'))",
                event.id,
              );
              run("DELETE FROM notifications WHERE event_id=? AND kind='reminder'", event.id);
              for (const id of userIds.filter((id) => id !== uid))
                notify(
                  id,
                  'Время встречи изменилось',
                  `${event.game} · ${new Intl.DateTimeFormat('ru', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(start))} (${tz}) · подтвердите участие заново`,
                  event.id,
                  'invite',
                );
            });
          invalidate(userIds);
          return send(200, { ok: true });
        }
        if (req.method === 'GET' && action === 'messages')
          return send(
            200,
            all(
              'SELECT m.*,u.name,u.color,u.avatar FROM messages m JOIN users u ON u.id=m.user_id WHERE m.event_id=? ORDER BY m.created_at DESC LIMIT 200',
              event.id,
            ).reverse(),
          );
        if (req.method === 'POST' && action === 'messages') {
          if (event.cancelled) fail(409, 'Встреча отменена');
          rate(`message:${uid}`, 40);
          const message = text(body.text, 'Сообщение', 1, 1000),
            id = randomUUID();
          transaction(() => {
            run('INSERT INTO messages VALUES(?,?,?,?,?)', id, event.id, uid, message, iso());
            for (const member of userIds.filter((i) => i !== uid))
              notify(
                member,
                `${get('SELECT name FROM users WHERE id=?', uid).name} · ${event.title}`,
                message.slice(0, 150),
                event.id,
                'message',
              );
          });
          invalidate(userIds);
          return send(201, { id });
        }
        if (req.method === 'POST' && action === 'reply') {
          if (event.cancelled || Date.parse(event.starts_at) <= Date.now())
            fail(409, 'Встреча уже началась или отменена');
          if (event.host_id === uid) fail(400, 'Организатор уже участвует');
          if (!['accepted', 'declined'].includes(body.status)) fail(400, 'Неизвестный ответ');
          if (event.my_status !== body.status)
            transaction(() => {
              run(
                'UPDATE participants SET status=? WHERE event_id=? AND user_id=?',
                body.status,
                event.id,
                uid,
              );
              notify(
                event.host_id,
                body.status === 'accepted'
                  ? 'Команда собирается!'
                  : 'Участник отказался от встречи',
                `${get('SELECT name FROM users WHERE id=?', uid).name}: ${body.status === 'accepted' ? 'буду играть' : 'отказался от участия'} · ${event.game} · ${event.title}`,
                event.id,
                body.status === 'accepted' ? 'reply' : 'decline',
              );
            });
          invalidate(userIds);
          return send(200, { ok: true });
        }
        if (req.method === 'POST' && action === 'cancel') {
          if (event.host_id !== uid) fail(403, 'Только организатор может отменить встречу');
          if (!event.cancelled)
            transaction(() => {
              run('UPDATE events SET cancelled=1,version=version+1 WHERE id=?', event.id);
              for (const id of userIds.filter((id) => id !== uid))
                notify(
                  id,
                  'Встреча отменена',
                  `${event.game} · ${event.title}`,
                  event.id,
                  'cancel',
                );
            });
          invalidate(userIds);
          return send(200, { ok: true });
        }
      }
      if (req.method === 'POST' && path === '/api/notifications/read') {
        if (body.id !== undefined) {
          if (typeof body.id !== 'string') fail(400, 'Неверное уведомление');
          run('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?', uid, body.id);
        } else run('UPDATE notifications SET is_read=1 WHERE user_id=?', uid);
        invalidate([uid]);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/notifications/clear') {
        transaction(() => {
          run(
            'DELETE FROM push_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE user_id=?)',
            uid,
          );
          run('DELETE FROM notifications WHERE user_id=?', uid);
        });
        invalidate([uid]);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/devices') {
        const deviceToken = text(body.token, 'Токен устройства', 10, 4096);
        if (!['android', 'ios'].includes(body.platform)) fail(400, 'Неизвестная платформа');
        const sounds = {};
        if (body.sounds !== undefined) {
          if (!body.sounds || typeof body.sounds !== 'object' || Array.isArray(body.sounds))
            fail(400, 'Некорректные звуки');
          for (const kind of [
            'invite',
            'reply',
            'decline',
            'message',
            'friend',
            'cancel',
            'reminder',
          ]) {
            const choice = body.sounds[kind];
            if (!choice) continue;
            if (
              typeof choice !== 'object' ||
              (choice.channelId !== undefined &&
                !/^partyup-[a-z0-9-]{1,100}$/.test(choice.channelId)) ||
              (choice.soundName !== undefined &&
                !/^partyup-[a-z0-9-]{1,100}\.(wav|caf|aiff?)$/.test(choice.soundName))
            )
              fail(400, 'Некорректный звук уведомления');
            sounds[kind] = {
              ...(choice.channelId ? { channelId: choice.channelId } : {}),
              ...(choice.soundName ? { soundName: choice.soundName } : {}),
            };
          }
        }
        transaction(() => {
          run(
            'INSERT INTO devices VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,updated_at=excluded.updated_at',
            deviceToken,
            uid,
            body.platform,
            iso(),
          );
          run(
            'INSERT INTO device_sounds(token,sounds) VALUES(?,?) ON CONFLICT(token) DO UPDATE SET sounds=excluded.sounds',
            deviceToken,
            JSON.stringify(sounds),
          );
        });
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/devices/remove') {
        run(
          'DELETE FROM devices WHERE token=? AND user_id=?',
          text(body.token, 'Токен устройства', 10, 4096),
          uid,
        );
        return send(200, { ok: true });
      }
      fail(404, 'Не найдено');
    } catch (error) {
      if (!res.headersSent) {
        if (!error.status) console.error(error);
        send(error.status || 500, { error: error.status ? error.message : 'Ошибка сервера' });
      } else res.end();
    }
  });
  server.requestTimeout = 30000;
  const timer = setInterval(() => {
    try {
      remind();
    } catch (error) {
      console.error(error);
    }
    void flushPush();
  }, 10000);
  timer.unref();
  return {
    server,
    store,
    seed,
    remind,
    flushPush,
    close: () => {
      clearInterval(timer);
      for (const responses of live.values()) for (const res of responses) res.end();
      server.close();
      store.db.close();
    },
  };
}
