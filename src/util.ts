import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

const PLAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function isPlanId(value: unknown): value is string {
  return typeof value === 'string' && PLAN_ID.test(value);
}

export const newPlanId = (): string => randomUUID();
export const newClaimId = (): string => randomUUID();
export const newDeleteKey = (): string => randomBytes(32).toString('base64url');
export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

export function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function networkOf(address: string): string {
  let host = address.trim();
  if (host.startsWith('::ffff:') && isIPv4(host.slice(7))) host = host.slice(7);
  if (isIPv4(host)) return host;
  const bare = host.split('%')[0] ?? host;
  if (isIPv6(bare)) {
    try {
      return `${ipv6Bytes(bare).subarray(0, 7).toString('hex')}/56`;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

export function ownerKey(secret: string, address: string): string {
  return createHmac('sha256', secret).update(networkOf(address)).digest('hex');
}

function ipv6Bytes(text: string): Buffer {
  let source = text;
  const last = source.lastIndexOf(':');
  const tail = source.slice(last + 1);
  if (tail.includes('.')) {
    const parts = tail.split('.').map(Number);
    const [a = 0, b = 0, c = 0, d = 0] = parts;
    source = `${source.slice(0, last + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = source.split('::');
  const headText = halves[0] ?? '';
  const restText = halves.length > 1 ? halves[1] ?? '' : '';
  const head = headText ? headText.split(':') : [];
  const rest = restText ? restText.split(':') : [];
  const groups = [...head, ...Array<string>(Math.max(0, 8 - head.length - rest.length)).fill('0'), ...rest];
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => bytes.writeUInt16BE(parseInt(group, 16), index * 2));
  return bytes;
}
