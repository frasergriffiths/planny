import { expect, test } from 'bun:test';
import { loadConfig } from '../src/config.js';
import { isHtmlType, parseDuration } from '../src/validate.js';
import { isPlanId, networkOf, newPlanId, ownerKey } from '../src/util.js';

const config = loadConfig({});

test('addresses are keyed by IPv4, or by a /56 for IPv6', () => {
  expect(networkOf('203.0.113.7')).toBe('203.0.113.7');
  expect(networkOf('::ffff:203.0.113.7')).toBe('203.0.113.7');
  expect(networkOf('2001:db8:1234:5600::1')).toBe(networkOf('2001:db8:1234:56ff:ffff:ffff:ffff:ffff'));
  expect(networkOf('2001:db8:1234:5600::1')).not.toBe(networkOf('2001:db8:1234:5700::1'));
});

test('owner keys are HMAC-keyed', () => {
  expect(ownerKey('a', '203.0.113.7')).toMatch(/^[0-9a-f]{64}$/);
  expect(ownerKey('a', '203.0.113.7')).not.toBe(ownerKey('b', '203.0.113.7'));
});

test('plan ids are lowercase v4 UUIDs', () => {
  expect(isPlanId(newPlanId())).toBe(true);
  expect(isPlanId(newPlanId().toUpperCase())).toBe(false);
  expect(isPlanId('../etc/passwd')).toBe(false);
});

test('durations are bounded by the 100-year cap', () => {
  expect(parseDuration(null, config)).toBe(config.defaultPlanMs);
  expect(parseDuration('12h', config)).toBe(12 * 3600e3);
  expect(parseDuration('100y', config)).toBe(100 * 365 * 24 * 3600e3);
  expect(() => parseDuration('101y', config)).toThrow(/up to 100 years/);
  expect(() => parseDuration('30', config)).toThrow(/number and a unit/);
  const short = loadConfig({ PLANNY_MAX_PLAN_YEARS: '2' });
  expect(() => parseDuration('3y', short)).toThrow(/up to 2 years/);
});

test('uploads accept text/html in UTF-8 only', () => {
  expect(isHtmlType('text/html')).toBe(true);
  expect(isHtmlType('Text/HTML; charset=UTF-8')).toBe(true);
  expect(isHtmlType('text/plain')).toBe(false);
  expect(isHtmlType('text/html; charset=latin1')).toBe(false);
});
