import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const isPlanId = (value) => typeof value === 'string' && PLAN_ID.test(value);
export const newPlanId = () => randomUUID();
export const newClaimId = () => randomUUID();
export const newDeleteKey = () => randomBytes(32).toString('base64url');
export const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

export function sameText(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export function networkOf(address) {
  let host = String(address ?? '').trim();
  if (host.startsWith('::ffff:') && isIPv4(host.slice(7))) host = host.slice(7);
  if (isIPv4(host)) return host;
  const bare = host.split('%')[0];
  if (isIPv6(bare)) {
    try {
      return `${ipv6Bytes(bare).subarray(0, 7).toString('hex')}/56`;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

export function ownerKey(secret, address) {
  return createHmac('sha256', secret).update(networkOf(address)).digest('hex');
}

function ipv6Bytes(text) {
  let s = text;
  const last = s.lastIndexOf(':');
  const tail = s.slice(last + 1);
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map(Number);
    s = `${s.slice(0, last + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest];
  const bytes = Buffer.alloc(16);
  groups.forEach((group, i) => bytes.writeUInt16BE(parseInt(group, 16), i * 2));
  return bytes;
}
