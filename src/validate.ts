import { DAY_MS, HOUR_MS, YEAR_MS, type AppConfig } from './config.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const UNIT_MS: Readonly<Record<string, number>> = { h: HOUR_MS, d: DAY_MS, w: 7 * DAY_MS, y: YEAR_MS };

export function parseDuration(raw: string | null | undefined, config: AppConfig): number {
  if (raw === null || raw === undefined || raw === '') return config.defaultPlanMs;
  const match = /^(\d{1,6})([hdwy])$/i.exec(raw.trim());
  if (!match) throw new ApiError(400, 'invalid_duration', 'Use a number and a unit: 12h, 30d, 2w or 5y.');
  const amount = match[1] ?? '0';
  const unit = (match[2] ?? 'h').toLowerCase();
  const ms = Number(amount) * (UNIT_MS[unit] ?? 0);
  if (ms < config.minPlanMs) {
    throw new ApiError(400, 'duration_too_short', 'The shortest plan lasts 1 hour. Use 1h or more.');
  }
  if (ms > config.maxPlanMs) {
    throw new ApiError(400, 'duration_too_long', `Plans can last up to ${config.maxPlanYears} years. Use ${config.maxPlanYears}y or less.`);
  }
  return ms;
}

export function isHtmlType(header: string | null): boolean {
  const [type, ...params] = (header ?? '').toLowerCase().split(';').map((part) => part.trim());
  const charset = params.find((part) => part.startsWith('charset='))?.slice('charset='.length).replace(/"/g, '');
  return type === 'text/html' && (charset === undefined || charset === 'utf-8' || charset === 'utf8');
}

export function badType(): ApiError {
  return new ApiError(415, 'unsupported_type', 'Send the plan as text/html in UTF-8. Set Content-Type: text/html.');
}
