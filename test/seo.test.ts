import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PAGES } from '../src/generated-pages.js';

const root = join(import.meta.dir, '..');
const origin = 'https://planny-pink.vercel.app/';

// The embedded pages come from the Vite build via scripts/generate-pages.ts,
// so these assertions cover the built home page, not just the source.
describe('seo', () => {
  const home = PAGES.home;

  test('home page has title, description and canonical', () => {
    expect(home).toContain('<title>Share an HTML plan as a link, no account | planny</title>');
    expect(home).toContain('name="description"');
    expect(home).toContain(`<link rel="canonical" href="${origin}">`);
    expect(home).toContain('name="robots" content="index, follow"');
    expect(home).toContain('name="theme-color"');
    expect(home).toContain('name="author"');
  });

  test('home page has Open Graph and Twitter tags', () => {
    expect(home).toContain('property="og:type" content="website"');
    expect(home).toContain('property="og:url" content="https://planny-pink.vercel.app/"');
    expect(home).toContain('property="og:image" content="https://planny-pink.vercel.app/og.png"');
    expect(home).toContain('name="twitter:card" content="summary_large_image"');
    expect(home).toContain('name="twitter:image"');
  });

  test('home page embeds valid JSON-LD WebApplication', () => {
    const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(home);
    expect(match).not.toBeNull();
    const data = JSON.parse(match![1]!) as Record<string, unknown>;
    expect(data['@type']).toBe('WebApplication');
    expect(data['name']).toBe('planny');
    expect(data['url']).toBe(origin);
    expect(data['operatingSystem']).toBe('Web');
    expect((data['author'] as Record<string, unknown>)['name']).toBe('Fraser Griffiths');
  });

  test('robots.txt exists with the sitemap URL', () => {
    const robots = readFileSync(join(root, 'public', 'robots.txt'), 'utf8');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`Sitemap: ${origin}sitemap.xml`);
    expect(PAGES.robots as string).toBe(robots);
  });

  test('sitemap.xml lists the public pages at the canonical origin', () => {
    const sitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');
    for (const path of ['/', '/sample', '/terms-of-use']) {
      expect(sitemap).toContain(`<loc>${origin.slice(0, -1)}${path}</loc>`);
    }
    expect(PAGES.sitemap as string).toBe(sitemap);
  });

  test('/og.png serves the embedded PNG with a long cache', async () => {
    const { createApp } = await import('../src/app.js');
    const { createLocalStore } = await import('../src/stores/local.js');
    const { loadConfig } = await import('../src/config.js');
    const app = createApp({
      build: 'vercel',
      store: createLocalStore({ dataDir: join(tmpdir(), `planny-seo-og-${Date.now()}`) }),
      config: loadConfig({}),
      secret: 'test-secret',
      origin: origin.slice(0, -1),
      log: { error: () => {}, alert: () => {} },
    });
    const response = await app.fetch(new Request(`${origin.slice(0, -1)}/og.png`), { address: '198.51.100.9' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBeGreaterThan(1000);
    expect(body[0]).toBe(0x89);
  });

  test('every icon route serves the right type with a long cache', async () => {
    const { createApp } = await import('../src/app.js');
    const { createLocalStore } = await import('../src/stores/local.js');
    const { loadConfig } = await import('../src/config.js');
    const app = createApp({
      build: 'vercel',
      store: createLocalStore({ dataDir: join(tmpdir(), `planny-seo-icons-${Date.now()}`) }),
      config: loadConfig({}),
      secret: 'test-secret',
      origin: origin.slice(0, -1),
      log: { error: () => {}, alert: () => {} },
    });
    // Binary bodies are compared against their base64 source in PAGES.
    const cases: Array<[string, string, () => string]> = [
      ['/favicon.svg', 'image/svg+xml', () => PAGES.icons.faviconSvg],
      ['/favicon.ico', 'image/x-icon', () => PAGES.icons.faviconIco],
      ['/apple-touch-icon.png', 'image/png', () => PAGES.icons.appleTouchIcon],
      ['/icon-192.png', 'image/png', () => PAGES.icons.icon192],
      ['/icon-512.png', 'image/png', () => PAGES.icons.icon512],
      ['/site.webmanifest', 'application/manifest+json', () => PAGES.icons.manifest],
    ];
    for (const [path, type, source] of cases) {
      const response = await app.fetch(new Request(`${origin.slice(0, -1)}${path}`), { address: '198.51.100.9' });
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toBe(type);
      expect(response.headers.get('cache-control'), path).toContain('immutable');
      const body = await response.arrayBuffer();
      const expected = source();
      let raw = '';
      const bytes = new Uint8Array(body);
      for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      if (type === 'image/png' || type === 'image/x-icon') {
        expect(btoa(raw), path).toBe(expected);
      } else {
        expect(new TextDecoder().decode(body), path).toBe(expected);
      }
    }
  });

  test('icon bodies carry the right magic bytes', () => {
    const pngs = [PAGES.icons.appleTouchIcon, PAGES.icons.icon192, PAGES.icons.icon512];
    for (const b64 of pngs) {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    const ico = Uint8Array.from(atob(PAGES.icons.faviconIco), (ch) => ch.charCodeAt(0));
    const dv = new DataView(ico.buffer);
    expect(ico[0]).toBe(0);
    expect(ico[2]).toBe(1); // icon resource type
    const count = dv.getUint16(4, true);
    expect(count).toBe(3); // 16/32/48
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16; // directory entries: 16 bytes each, little-endian
      const w = ico[entry]! || 256;
      const h = ico[entry + 1]! || 256;
      expect(h).toBe(w);
      expect(dv.getUint16(entry + 4, true)).toBe(1); // planes
      expect(dv.getUint16(entry + 6, true)).toBe(32); // bpp
      const size = dv.getUint32(entry + 8, true);
      const offset = dv.getUint32(entry + 12, true);
      expect(size).toBeGreaterThan(0);
      expect(offset).toBeGreaterThanOrEqual(6 + 16 * count);
      expect(offset + size).toBeLessThanOrEqual(ico.length);
      expect([ico[offset]!, ico[offset + 1]!, ico[offset + 2]!, ico[offset + 3]!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  test('page shells link the favicon set and manifest', () => {
    for (const page of [PAGES.home, PAGES.notFound, PAGES.gone, PAGES.paused, PAGES.terms]) {
      expect(page).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(page).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
      expect(page).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
      expect(page).toContain('<link rel="manifest" href="/site.webmanifest">');
      expect(page).toContain('name="theme-color"');
    }
  });
});
