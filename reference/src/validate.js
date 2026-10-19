import { DAY_MS, HOUR_MS, YEAR_MS } from './config.js';

export class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const UNIT_MS = { h: HOUR_MS, d: DAY_MS, w: 7 * DAY_MS, y: YEAR_MS };

export function parseName(raw, maxLength) {
  const name = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) throw new ApiError(400, 'name_required', 'Add a name with ?name=. Example: name=Q4%20rollout');
  if ([...name].length > maxLength) {
    throw new ApiError(400, 'name_too_long', `Names can be up to ${maxLength} characters.`);
  }
  return name;
}

export function parseDuration(raw, config) {
  if (raw === null || raw === '') return config.defaultPlanMs;
  const match = /^(\d{1,6})([hdwy])$/i.exec(String(raw).trim());
  if (!match) throw new ApiError(400, 'invalid_duration', 'Use a number and a unit: 12h, 30d, 2w or 5y.');
  const ms = Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
  if (ms < config.minPlanMs) {
    throw new ApiError(400, 'duration_too_short', 'The shortest plan lasts 1 hour. Use 1h or more.');
  }
  if (ms > config.maxPlanMs) {
    throw new ApiError(400, 'duration_too_long', `Plans can last up to ${config.maxPlanYears} years. Use ${config.maxPlanYears}y or less.`);
  }
  return ms;
}

export function checkHtmlType(header) {
  const [type, ...params] = String(header ?? '').toLowerCase().split(';').map((part) => part.trim());
  const charset = params.find((part) => part.startsWith('charset='))?.slice('charset='.length).replace(/"/g, '');
  if (type !== 'text/html' || (charset !== undefined && charset !== 'utf-8' && charset !== 'utf8')) {
    throw new ApiError(415, 'unsupported_type', 'Send the plan as text/html in UTF-8. Set Content-Type: text/html.');
  }
}
