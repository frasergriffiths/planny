#!/usr/bin/env bun
// Generate the Tailwind theme and the plan templates' :root block from tokens.json.
// The JSON is the source of truth; nothing below should hold a second copy of a token value.
//   bun run scripts/generate-tokens.ts            write the generated blocks
//   bun run scripts/generate-tokens.ts --check    fail if any generated block is stale
//   bun run scripts/generate-tokens.ts --file f   also write the block into another plan file
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = join(import.meta.dir, '..');
const TOKEN_NAMES = ['radius-card', 'radius-bar', 'radius-swatch', 'line', 'accent', 'panel', 'inset-card', 'border-card'] as const;
type TokenName = (typeof TOKEN_NAMES)[number];
type Tokens = Record<TokenName, string>;

const ROOT_FILES = [
  join(root, 'skills', 'planny', 'template.html'),
  join(root, 'public', 'sample', 'index.html'),
];
const THEME_FILE = join(root, 'web', 'src', 'index.css');
const ROOT_MARKERS = /(\/\* TOKENS \*\/\n)([\s\S]*?)(\n\s*\/\* \/TOKENS \*\/)/;
const THEME_MARKERS = /(\/\* TOKENS:THEME \*\/\n)([\s\S]*?)(\n\s*\/\* \/TOKENS:THEME \*\/)/;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readTokens(): Tokens {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
  } catch (error) {
    fail(`tokens.json is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('tokens.json must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const extra = Object.keys(record).filter((name) => !TOKEN_NAMES.includes(name as TokenName));
  if (extra.length > 0) fail(`tokens.json has unknown names: ${extra.join(', ')}`);
  const tokens = {} as Tokens;
  for (const name of TOKEN_NAMES) {
    const value = record[name];
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`tokens.json is missing a string value for ${name}.`);
    }
    const pixel = name.startsWith('radius-') || name === 'inset-card' || name === 'border-card';
    if (pixel && !/^\d+px$/.test(value)) {
      fail(`tokens.json ${name} must be a pixel value such as 12px.`);
    }
    if (!pixel && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      fail(`tokens.json ${name} must be a six-digit hex colour.`);
    }
    tokens[name] = value;
  }
  return tokens;
}

function px(value: string): number {
  return Number(value.replace(/px$/, ''));
}

function padValue(tokens: Tokens): string {
  const inset = px(tokens['inset-card']);
  const border = px(tokens['border-card']);
  if (!Number.isFinite(inset) || !Number.isFinite(border) || inset <= border) {
    fail('tokens.json needs inset-card larger than border-card.');
  }
  return `${inset - border}px`;
}

function rootBlock(tokens: Tokens): string {
  const lines = TOKEN_NAMES.map((name) => `    --${name}: ${tokens[name]};`);
  lines.push(`    --pad-card: ${padValue(tokens)};`);
  return lines.join('\n');
}

function themeBlock(tokens: Tokens): string {
  const lines = TOKEN_NAMES.map((name) => {
    const cssName = name.startsWith('radius-') ? `--${name}` : name === 'line' || name === 'accent' || name === 'panel' ? `--color-${name}` : `--${name}`;
    return `  ${cssName}: ${tokens[name]};`;
  });
  lines.push(`  --pad-card: ${padValue(tokens)};`);
  return lines.join('\n');
}

function replaceBlock(source: string, pattern: RegExp, body: string, path: string): string {
  if (!pattern.test(source)) fail(`${path} has no token markers.`);
  return source.replace(pattern, `$1${body}$3`);
}

function expected(path: string, tokens: Tokens): string {
  const source = readFileSync(path, 'utf8');
  if (path === THEME_FILE) {
    const theme = `@theme {\n${themeBlock(tokens)}\n}`;
    return replaceBlock(source, THEME_MARKERS, theme, path);
  }
  return replaceBlock(source, ROOT_MARKERS, rootBlock(tokens), path);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const extraFiles: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--file') {
    const file = args[index + 1];
    if (!file) fail('--file needs a path.');
    extraFiles.push(resolve(process.cwd(), file));
    index += 1;
  } else if (args[index] !== '--check') {
    fail(`Unknown argument: ${args[index]}`);
  }
}

const tokens = readTokens();
const files = [...ROOT_FILES, THEME_FILE, ...extraFiles];
let stale = 0;
for (const file of files) {
  let next: string;
  try {
    next = expected(file, tokens);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const current = readFileSync(file, 'utf8');
  if (next === current) continue;
  if (check) {
    stale += 1;
    console.error(`tokens out of date: ${file}`);
  } else {
    writeFileSync(file, next);
    console.log(`wrote ${file}`);
  }
}
if (check) {
  if (stale > 0) process.exitCode = 1;
  else console.log('tokens up to date');
}
