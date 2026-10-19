#!/usr/bin/env bun
// Installs, removes and checks the local build as a LaunchAgent for this user.
//   bun run local/service.ts install | uninstall [--purge] | status
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LABEL = 'dev.planny.local';
const PORT = Number(process.env.PLANNY_LOCAL_PORT ?? 4317);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = homedir();
const paths = {
  dataDir: process.env.PLANNY_DATA_DIR || join(home, 'Library', 'Application Support', 'planny-local'),
  log: join(home, 'Library', 'Logs', 'planny-local.log'),
  plist: join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
};
const domain = `gui/${process.getuid?.() ?? 501}`;
const target = `${domain}/${LABEL}`;
const bun = Bun.which('bun') ?? join(home, '.bun', 'bin', 'bun');
const serverFile = join(repo, 'server.ts');

const xml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function plistFor({ runtime, server, workdir, dataDir, log }: {
  runtime: string;
  server: string;
  workdir: string;
  dataDir: string;
  log: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(runtime)}</string>
    <string>${xml(server)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workdir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PLANNY_DATA_DIR</key>
    <string>${xml(dataDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[], { allowFailure = false } = {}): string | null {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

const isLoaded = (): boolean => launchctl(['print', target], { allowFailure: true }) !== null;

function portAnswers(): Promise<boolean> {
  return new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port: PORT });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

async function waitFor(check: () => Promise<boolean>, seconds: number): Promise<boolean> {
  for (let index = 0; index < seconds * 4; index += 1) {
    if (await check()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function install(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('The LaunchAgent only installs on macOS.');
  if (!existsSync(serverFile)) throw new Error('Run the install from the repo folder.');
  if (!existsSync(bun)) throw new Error('Bun is not installed.');
  if (isLoaded()) {
    launchctl(['bootout', target], { allowFailure: true });
    await waitFor(async () => !(await portAnswers()), 10);
  }
  if (await portAnswers()) throw new Error(`Port ${PORT} is in use by another process. Stop it, then run install again.`);
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.log), { recursive: true });
  mkdirSync(dirname(paths.plist), { recursive: true });
  writeFileSync(paths.plist, plistFor({
    runtime: bun,
    server: serverFile,
    workdir: repo,
    dataDir: paths.dataDir,
    log: paths.log,
  }));
  launchctl(['bootstrap', domain, paths.plist]);
  if (!(await waitFor(portAnswers, 20))) throw new Error(`planny did not answer on 127.0.0.1:${PORT}. Read ${paths.log}.`);
  console.log(`planny is running on http://127.0.0.1:${PORT} as ${LABEL} (Bun).`);
  console.log('Remove it with: bun run local:uninstall');
}

async function uninstall({ purge }: { purge: boolean }): Promise<void> {
  if (isLoaded()) launchctl(['bootout', target], { allowFailure: true });
  rmSync(paths.plist, { force: true });
  await waitFor(async () => !(await portAnswers()), 10);
  if (await portAnswers()) console.log(`Port ${PORT} still answers. A planny server started by hand may be running.`);
  if (purge) {
    rmSync(paths.dataDir, { recursive: true, force: true });
    rmSync(paths.log, { force: true });
  }
  console.log(`planny local service removed. ${purge
    ? 'Plan data, the address key and the log were deleted.'
    : `Plan data is kept in ${paths.dataDir}. Add --purge to delete it.`}`);
}

async function status(): Promise<void> {
  const printed = launchctl(['print', target], { allowFailure: true });
  const pid = printed?.match(/\bpid = (\d+)/)?.[1];
  console.log(`LaunchAgent file: ${existsSync(paths.plist) ? paths.plist : 'not installed'}`);
  console.log(`Loaded: ${printed ? `yes${pid ? `, pid ${pid}` : ''}` : 'no'}`);
  console.log(`127.0.0.1:${PORT}: ${(await portAnswers()) ? 'answering' : 'not answering'}`);
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...flags] = argv;
  if (command === 'install') return install();
  if (command === 'uninstall') return uninstall({ purge: flags.includes('--purge') });
  if (command === 'status') return status();
  console.error('Usage: bun run local/service.ts install | uninstall [--purge] | status');
  process.exitCode = 2;
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
