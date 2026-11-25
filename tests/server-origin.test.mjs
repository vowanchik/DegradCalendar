import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverOrigin } from '../desktop/server-origin.cjs';

test('desktop notifications accept remote HTTP, HTTPS and IPv6 server origins', () => {
  assert.equal(serverOrigin('http://203.0.113.10:3001/'), 'http://203.0.113.10:3001');
  assert.equal(serverOrigin('http://[2001:db8::1]:3001'), 'http://[2001:db8::1]:3001');
  assert.equal(serverOrigin('https://party.example.com:443/'), 'https://party.example.com');
});

test('desktop notifications reject non-HTTP protocols and ambiguous server addresses', () => {
  for (const address of [
    undefined,
    { toString: () => 'http://party.example.com' },
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://party.example.com',
    'http://alice:secret@party.example.com',
    'http://party.example.com/api',
    'http://party.example.com/?token=secret',
    'http://party.example.com/#session',
  ])
    assert.throws(() => serverOrigin(address));
});
