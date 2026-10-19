import { Readable } from 'node:stream';

interface NodeHeaders {
  [key: string]: string | string[] | undefined;
}

interface NodeRequestLike {
  method?: string;
  url?: string;
  headers: NodeHeaders;
  socket?: { remoteAddress?: string };
}

export function toRequest(req: NodeRequestLike, protocol: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const url = new URL(req.url ?? '/', `${protocol}://${req.headers.host ?? 'localhost'}`);
  return new Request(url, {
    method,
    headers,
    ...(hasBody && 'body' in req ? { body: Readable.toWeb(req as unknown as Readable) as unknown as ReadableStream<Uint8Array> } : {}),
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

export function clientAddress(req: NodeRequestLike, { forwarded = false }: { forwarded?: boolean } = {}): string {
  if (forwarded) {
    const raw = Object.entries(req.headers).find(([name]) => name.toLowerCase() === 'x-vercel-forwarded-for')?.[1];
    const value = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
    return value.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket?.remoteAddress ?? 'unknown';
}
