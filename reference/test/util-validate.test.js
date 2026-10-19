import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { checkHtmlType, parseDuration, parseName } from '../src/validate.js';
import { isPlanId, networkOf, newPlanId, ownerKey } from '../src/util.js';

const config = loadConfig({});
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
};

test('IPv4 addresses are keyed by the full address', () => {
  assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
  assert.equal(networkOf('::ffff:203.0.113.7'), '203.0.113.7');
});

test('IPv6 addresses share a key within one /56, and differ across /56s', () => {
  const key = networkOf('2001:db8:1234:5600::1');
  assert.equal(key, networkOf('2001:db8:1234:56ff:ffff:ffff:ffff:ffff'));
  assert.notEqual(key, networkOf('2001:db8:1234:5700::1'));
  assert.match(key, /\/56$/);
});

test('owner keys are HMAC-keyed, not the raw address', () => {
  const key = ownerKey('secret-a', '203.0.113.7');
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notEqual(key, '203.0.113.7');
  assert.notEqual(key, ownerKey('secret-b', '203.0.113.7'));
  assert.equal(ownerKey('secret-a', '2001:db8:1234:5600::1'), ownerKey('secret-a', '2001:db8:1234:56aa::2'));
});

test('plan ids are random v4 UUIDs in lower case', () => {
  assert.ok(isPlanId(newPlanId()));
  assert.equal(isPlanId('00000000-0000-1000-8000-000000000000'), false);
  assert.equal(isPlanId('../etc/passwd'), false);
  assert.equal(isPlanId(newPlanId().toUpperCase()), false);
});

test('durations take h, d, w and y, default to 30 days, and stop at the cap', () => {
  assert.equal(parseDuration(null, config), 30 * 24 * 3600e3);
  assert.equal(parseDuration('12h', config), 12 * 3600e3);
  assert.equal(parseDuration('2w', config), 14 * 24 * 3600e3);
  assert.equal(parseDuration('100y', config), 100 * 365 * 24 * 3600e3);
  assert.equal(parseDuration('36500d', config), 100 * 365 * 24 * 3600e3);
  assert.equal(codeOf(() => parseDuration('0h', config)), 'duration_too_short');
  assert.equal(codeOf(() => parseDuration('101y', config)), 'duration_too_long');
  assert.equal(codeOf(() => parseDuration('36501d', config)), 'duration_too_long');
  assert.equal(codeOf(() => parseDuration('30', config)), 'invalid_duration');
  assert.equal(codeOf(() => parseDuration('1.5d', config)), 'invalid_duration');
  assert.equal(codeOf(() => parseDuration('forever', config)), 'invalid_duration');
});

test('the 100-year cap is one setting', () => {
  const short = loadConfig({ PLANNY_MAX_PLAN_YEARS: '2' });
  assert.equal(codeOf(() => parseDuration('3y', short)), 'duration_too_long');
  assert.equal(parseDuration('2y', short), 2 * 365 * 24 * 3600e3);
});

test('names are trimmed, collapsed and bounded in code points', () => {
  assert.equal(parseName('  Q4\n\t rollout \u0007 plan ', 120), 'Q4 rollout plan');
  assert.equal(codeOf(() => parseName('   ', 120)), 'name_required');
  assert.equal(codeOf(() => parseName('x'.repeat(121), 120)), 'name_too_long');
  assert.equal(parseName('é'.repeat(120), 120).length, 120);
});

test('bodies must be text/html in UTF-8', () => {
  assert.doesNotThrow(() => checkHtmlType('text/html'));
  assert.doesNotThrow(() => checkHtmlType('Text/HTML; charset=UTF-8'));
  assert.equal(codeOf(() => checkHtmlType('text/plain')), 'unsupported_type');
  assert.equal(codeOf(() => checkHtmlType('text/html; charset=latin1')), 'unsupported_type');
  assert.equal(codeOf(() => checkHtmlType(null)), 'unsupported_type');
});
