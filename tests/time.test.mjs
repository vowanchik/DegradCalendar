import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedUtc, dateKey } from '../src/time.ts';
test('convert Moscow and fractional offsets independently from the device timezone', () => {
  assert.equal(zonedUtc('2026-12-01', '20:00', 'Europe/Moscow'), '2026-12-01T17:00:00.000Z');
  assert.equal(zonedUtc('2026-12-01', '20:00', 'Asia/Kathmandu'), '2026-12-01T14:15:00.000Z');
  assert.equal(dateKey('2026-12-01T23:00Z', 'Europe/Moscow'), '2026-12-02');
});
test('reject missing DST hour and choose earlier occurrence during repeated hour', () => {
  assert.throws(() => zonedUtc('2026-03-29', '02:30', 'Europe/Berlin'), /перевода часов/);
  assert.equal(zonedUtc('2026-10-25', '02:30', 'Europe/Berlin'), '2026-10-25T00:30:00.000Z');
});
