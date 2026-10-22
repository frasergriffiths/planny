import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Page, inviteVisible, type PageKind } from '../web/src/Page.js';

// The built pages run in the browser after #root, so a server-rendered render is the
// closest the suite gets to them: Page reads document.documentElement.dataset.
function render(kind: PageKind, dataset: Record<string, string>): string {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: { dataset } },
    configurable: true,
  });
  try {
    return renderToStaticMarkup(createElement(Page, { kind }));
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete (globalThis as { document?: unknown }).document;
  }
}

test('the invite shows only for notfound and gone, and only when marked on', () => {
  expect(inviteVisible('notfound', { plannyInvite: 'on' })).toBe(true);
  expect(inviteVisible('gone', { plannyInvite: 'on' })).toBe(true);
  expect(inviteVisible('notfound', {})).toBe(false);
  expect(inviteVisible('gone', {})).toBe(false);
  expect(inviteVisible('notfound', { plannyInvite: 'off' })).toBe(false);
  expect(inviteVisible('gone', { plannyInvite: 'off' })).toBe(false);
  expect(inviteVisible('home', { plannyInvite: 'on' })).toBe(false);
  expect(inviteVisible('paused', { plannyInvite: 'on' })).toBe(false);
});

test('the rendered 404 and 410 cards carry the invite when marked on', () => {
  for (const kind of ['notfound', 'gone'] as const) {
    const html = render(kind, { plannyInvite: 'on' });
    expect(html).toContain('data-planny-invite');
    expect(html).toContain('Publish it with Planny');
    expect(html).toContain('https://use-planny.vercel.app');
  }
});

test('the rendered pages have no invite when the marker is off or absent', () => {
  for (const kind of ['notfound', 'gone'] as const) {
    for (const dataset of [{ plannyInvite: 'off' }, {}]) {
      const html = render(kind, dataset);
      expect(html).not.toContain('data-planny-invite');
      expect(html).not.toContain('Publish it with Planny');
    }
  }
  // The render is a real page either way, so the negative check is not vacuous.
  expect(render('notfound', { plannyInvite: 'off' })).toContain('No plan at this link.');
});

test('the generic 404, the 429 page and home never render the invite', () => {
  for (const kind of ['notfound', 'gone', 'paused', 'home'] as const) {
    const html = render(kind, {});
    expect(html).not.toContain('data-planny-invite');
  }
});
