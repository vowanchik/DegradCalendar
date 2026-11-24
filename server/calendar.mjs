const escape = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
const stamp = (value) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
// RFC 5545: fold at 75 octets without splitting a UTF-8 code point.
function fold(line) {
  const chunks = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char) > 75) {
      chunks.push(current);
      current = ' ';
    }
    current += char;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}
export function calendarFile(event, origin = '') {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PartyUp//Game nights//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@partyup`,
    `DTSTAMP:${stamp(event.created_at)}`,
    `SEQUENCE:${event.version ?? 0}`,
    `DTSTART:${stamp(event.starts_at)}`,
    `DTEND:${stamp(event.ends_at)}`,
    `SUMMARY:${escape(event.game + ' · ' + event.title)}`,
    `DESCRIPTION:${escape(event.notes || 'Игровая встреча в PartyUp')}`,
    `LOCATION:${escape(event.location || 'Онлайн')}`,
    `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(origin ? [`URL:${origin}/?event=${encodeURIComponent(event.id)}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Через 15 минут играем!',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
