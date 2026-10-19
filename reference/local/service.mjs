#!/usr/bin/env node
// Installs, removes and checks the local build as a LaunchAgent for this user.
//   node local/service.mjs install             start at login and keep it running
//   node local/service.mjs uninstall           stop it and remove the LaunchAgent; plan data stays
//   node local/service.mjs uninstall --purge   also delete plan data, the address key and the log
//   node local/service.mjs status
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LABEL = 'dev.planny.local';
const PORT = Number(process.env.PLANNY_LOCAL_PORT || 4317);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = homedir();
const paths = {
  dataDir: process.env.PLANNY_DATA_DIR || join(home, 'Library', 'Application Support', 'planny-local'),
  log: join(home, 'Library', 'Logs', 'planny-local.log'),
  plist: join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
};
const domain = `gui/${process.getuid()}`;
const target = `${domain}/${LABEL}`;

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function plistFor({ node, server, workdir, dataDir, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
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

function launchctl(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function isLoaded() {
  return launchctl(['print', target], { allowFailure: true }) !== null;
}

function portAnswers() {
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

async function waitFor(check, seconds) {
  for (let i = 0; i < seconds * 4; i += 1) {
    if (await check()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('The LaunchAgent only installs on macOS.');
  if (!existsSync(join(repo, 'node_modules'))) throw new Error('Run npm install in the repo first.');
  if (isLoaded()) {
    launchctl(['bootout', target], { allowFailure: true });
    await waitFor(async () => !(await portAnswers()), 10);
  }
  if (await portAnswers()) {
    throw new Error(`Port ${PORT} is in use by another process. Stop it, then run install again.`);
  }
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(paths.log), { recursive: true });
  mkdirSync(dirname(paths.plist), { recursive: true });
  writeFileSync(paths.plist, plistFor({
    node: process.execPath,
    server: join(repo, 'local', 'server.js'),
    workdir: repo,
    dataDir: paths.dataDir,
    log: paths.log,
  }));
  launchctl(['bootstrap', domain, paths.plist]);
  if (!(await waitFor(portAnswers, 15))) {
    throw new Error(`planny did not answer on 127.0.0.1:${PORT}. Read ${paths.log}.`);
  }
  console.log(`planny local build is running on http://127.0.0.1:${PORT} as ${LABEL}.`);
  console.log(`Remove it with: npm run local:uninstall`);
}

async function uninstall({ purge }) {
  if (isLoaded()) launchctl(['bootout', target], { allowFailure: true });
  rmSync(paths.plist, { force: true });
  await waitFor(async () => !(await portAnswers()), 10);
  if (await portAnswers()) {
    console.log(`Port ${PORT} still answers. A planny server started by hand may be running; stop it with Ctrl-C.`);
  }
  if (purge) {
    rmSync(paths.dataDir, { recursive: true, force: true });
    rmSync(paths.log, { force: true });
  }
  console.log(`planny local service removed. ${purge
    ? 'Plan data, the address key and the log were deleted.'
    : `Plan data is kept in ${paths.dataDir}. Add --purge to delete it.`}`);
}

async function status() {
  const printed = launchctl(['print', target], { allowFailure: true });
  const pid = printed?.match(/\bpid = (\d+)/)?.[1];
  console.log(`LaunchAgent file: ${existsSync(paths.plist) ? paths.plist : 'not installed'}`);
  console.log(`Loaded: ${printed ? `yes${pid ? `, pid ${pid}` : ''}` : 'no'}`);
  console.log(`127.0.0.1:${PORT}: ${(await portAnswers()) ? 'answering' : 'not answering'}`);
}

export async function main(argv) {
  const [command, ...flags] = argv;
  if (command === 'install') return install();
  if (command === 'uninstall') return uninstall({ purge: flags.includes('--purge') });
  if (command === 'status') return status();
  console.error('Usage: node local/service.mjs install | uninstall [--purge] | status');
  process.exitCode = 2;
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
