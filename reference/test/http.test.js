import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientAddress } from '../src/http.js';

test('local ignores forwarded headers, and Vercel reads only the first forwarded address', () => {
  const req = {
    headers: { 'x-vercel-forwarded-for': '198.51.100.9, 10.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(clientAddress(req), '127.0.0.1');
  assert.equal(clientAddress(req, { forwarded: true }), '198.51.100.9');
  assert.equal(clientAddress({ headers: {}, socket: {} }, { forwarded: true }), 'unknown');
});
