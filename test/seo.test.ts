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
});
