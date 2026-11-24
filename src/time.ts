export const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
export const zones = [
  ...new Set([
    defaultZone,
    'Europe/Moscow',
    'Europe/Kaliningrad',
    'Europe/Samara',
    'Asia/Yekaterinburg',
    'Asia/Novosibirsk',
    'Asia/Vladivostok',
    'Europe/Berlin',
    'Asia/Tbilisi',
    'Asia/Almaty',
    'America/New_York',
  ]),
];
export const dateKey = (value: string | Date, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
export const formatDate = (
  value: string | Date,
  zone: string,
  options: Intl.DateTimeFormatOptions = {},
) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
    ...options,
  }).format(new Date(value));
export const formatTime = (value: string, zone: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
const parts = (value: Date, zone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)]),
  );
export function zonedUtc(date: string, time: string, zone: string) {
  const [y, m, d] = date.split('-').map(Number),
    [h, min] = time.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(guess), zone);
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  const matches = (ms: number) => {
    const p = parts(new Date(ms), zone);
    return p.year === y && p.month === m && p.day === d && p.hour === h && p.minute === min;
  };
  if (!matches(guess)) throw new Error('Такого времени нет из-за перевода часов. Выберите другое.');
  // During a repeated DST hour consistently choose the earliest occurrence.
  for (const offset of [7200000, 3600000, 1800000]) if (matches(guess - offset)) guess -= offset;
  return new Date(guess).toISOString();
}
