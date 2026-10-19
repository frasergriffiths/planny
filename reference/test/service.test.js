import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LABEL, plistFor } from '../local/service.mjs';

test('the LaunchAgent starts the local server at login and keeps it running', () => {
  const xml = plistFor({
    node: '/usr/local/bin/node',
    server: '/repo/local/server.js',
    workdir: '/repo',
    dataDir: '/data',
    log: '/logs/planny-local.log',
  });
  assert.match(xml, new RegExp(`<string>${LABEL}</string>`));
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<string>\/repo\/local\/server.js<\/string>/);
  assert.doesNotMatch(xml, /0\.0\.0\.0/);
});

test('paths are escaped in the plist', () => {
  const xml = plistFor({
    node: '/opt/node',
    server: '/Users/a & b/planny/local/server.js',
    workdir: '/repo',
    dataDir: '/data',
    log: '/logs/x.log',
  });
  assert.match(xml, /\/Users\/a &amp; b\/planny\/local\/server.js/);
});
