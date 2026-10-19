import { Readable } from 'node:stream';

export function toRequest(req, protocol) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const url = new URL(req.url || '/', `${protocol}://${req.headers.host || 'localhost'}`);
  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  });
}

export function clientAddress(req, { forwarded = false } = {}) {
  if (forwarded) {
    return String(req.headers['x-vercel-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
}

export async function sendResponse(res, response, method) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  if (method === 'HEAD' || !response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
