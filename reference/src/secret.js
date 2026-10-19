import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MIN_LENGTH = 32;

// The key is written to a temp file and renamed, so a crash cannot leave an empty key behind.
// An empty or short key stops startup, because the address keys would then be easy to reverse.
export function loadOrCreateSecret(file) {
  let existing = null;
  try {
    existing = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing !== null) {
    const secret = existing.trim();
    if (secret.length < MIN_LENGTH) {
      throw new Error(`The address key in ${file} is missing or too short. Delete the file to create a new key; per-address limits restart when you do.`);
    }
    return secret;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString('base64url');
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${secret}\n`, { mode: 0o600 });
  renameSync(temp, file);
  return secret;
}
