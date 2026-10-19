// The error codes the server can emit, in one place.
//
// The public pages, the JSON errors and the skill reference are meant to read
// from this list. Today the route handlers still build their own responses, so
// the next step is to replace those strings with lookups here. Until then this
// is the contract the skill documents and the tests check.

export type ErrorScope = 'upload' | 'view' | 'delete' | 'admin' | 'config';
export type ErrorResponse = 'json' | 'page' | 'both';
export type ErrorRetry = 'none' | 'retry-after' | 'reset-date' | 'retry-after-and-reset-date';

export interface ErrorCode {
  readonly code: string;
  readonly status: number;
  readonly scope: ErrorScope;
  readonly when: string;
  readonly retry: ErrorRetry;
  readonly response: ErrorResponse;
  readonly notes?: string;
}

export const ERROR_CODES: readonly ErrorCode[] = [
  // 400, upload validation
  {
    code: 'name_required',
    status: 400,
    scope: 'upload',
    when: 'The name is missing or blank.',
    retry: 'none',
    response: 'json',
    notes: 'Add ?name= to the upload URL.',
  },
  {
    code: 'name_too_long',
    status: 400,
    scope: 'upload',
    when: 'The name is over 120 characters.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'invalid_duration',
    status: 400,
    scope: 'upload',
    when: 'The duration is not a number plus h, d, w, m or y.',
    retry: 'none',
    response: 'json',
    notes: 'Examples: 12h, 30d, 2w, 6m, 1y.',
  },
  {
    code: 'duration_too_short',
    status: 400,
    scope: 'upload',
    when: 'The duration is under 1 hour.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'duration_too_long',
    status: 400,
    scope: 'upload',
    when: 'The duration is over 100 years.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'empty_body',
    status: 400,
    scope: 'upload',
    when: 'The request body is empty.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'invalid_encoding',
    status: 400,
    scope: 'upload',
    when: 'The body is not valid UTF-8.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'too_deep',
    status: 400,
    scope: 'upload',
    when: 'The HTML nests more than 200 levels deep.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'invalid_query',
    status: 400,
    scope: 'upload',
    when: 'The query contains anything other than name and duration.',
    retry: 'none',
    response: 'json',
  },

  // 401, 403 and 405
  {
    code: 'missing_key',
    status: 401,
    scope: 'delete',
    when: 'The DELETE has no Authorization: Bearer key.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'unauthorized',
    status: 401,
    scope: 'admin',
    when: 'The admin token is missing or wrong, or the admin rate limit refused the call.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'wrong_key',
    status: 403,
    scope: 'delete',
    when: 'The delete key does not match the plan.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'method_not_allowed',
    status: 405,
    scope: 'upload',
    when: 'The method is wrong for the path.',
    retry: 'none',
    response: 'json',
    notes: 'The response carries an allow header.',
  },

  // 404
  {
    code: 'no_plan',
    status: 404,
    scope: 'delete',
    when: 'The plan id is unknown or malformed.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'not_found',
    status: 404,
    scope: 'view',
    when: 'The link is unknown, malformed, or has a query string.',
    retry: 'none',
    response: 'page',
    notes: 'A query string is a 404 and does not count as a read.',
  },

  // 409
  {
    code: 'busy',
    status: 409,
    scope: 'delete',
    when: 'A removal is already in flight for this plan.',
    retry: 'none',
    response: 'json',
  },

  // 410
  {
    code: 'already_removed',
    status: 410,
    scope: 'delete',
    when: 'The plan was already deleted or taken down.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'expired',
    status: 410,
    scope: 'view',
    when: 'The plan reached its expiry time.',
    retry: 'none',
    response: 'page',
  },
  {
    code: 'deleted',
    status: 410,
    scope: 'view',
    when: 'The author deleted the plan.',
    retry: 'none',
    response: 'page',
  },
  {
    code: 'takedown',
    status: 410,
    scope: 'view',
    when: 'planny took the plan down.',
    retry: 'none',
    response: 'page',
  },

  // 413 and 415
  {
    code: 'too_large',
    status: 413,
    scope: 'upload',
    when: 'The raw body is over 4,194,304 bytes.',
    retry: 'none',
    response: 'json',
    notes: 'The cap is inclusive on the raw body. A fragment near the cap can grow past it after the wrapper is added.',
  },
  {
    code: 'unsupported_type',
    status: 415,
    scope: 'upload',
    when: 'The body is not text/html in UTF-8.',
    retry: 'none',
    response: 'json',
  },

  // 429
  {
    code: 'rate_limited',
    status: 429,
    scope: 'upload',
    when: 'Too many uploads from this address.',
    retry: 'retry-after',
    response: 'json',
  },
  {
    code: 'rate_limited',
    status: 429,
    scope: 'view',
    when: 'Too many views from this address.',
    retry: 'retry-after',
    response: 'page',
  },
  {
    code: 'storage_limit',
    status: 429,
    scope: 'upload',
    when: 'This address has used its stored share.',
    retry: 'none',
    response: 'json',
    notes: 'Deleting or expiring a plan frees the space. There is no monthly reset date.',
  },

  // 500
  {
    code: 'upload_failed',
    status: 500,
    scope: 'upload',
    when: 'The plan did not reach storage.',
    retry: 'none',
    response: 'json',
    notes: 'Nothing was kept. Upload again.',
  },
  {
    code: 'upload_interrupted',
    status: 500,
    scope: 'upload',
    when: 'The upload was cancelled before it went live.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'server_error',
    status: 500,
    scope: 'upload',
    when: 'An unexpected error hit an API route.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'server_error',
    status: 500,
    scope: 'view',
    when: 'The plan page could not be loaded.',
    retry: 'none',
    response: 'page',
  },

  // 503
  {
    code: 'uploads_paused',
    status: 503,
    scope: 'upload',
    when: 'The upload switch is off.',
    retry: 'none',
    response: 'json',
  },
  {
    code: 'storage_full',
    status: 503,
    scope: 'upload',
    when: 'The site has no room for new plans.',
    retry: 'none',
    response: 'json',
    notes: 'Expiring or deleting plans frees space. There is no monthly reset date.',
  },
  {
    code: 'uploads_monthly_limit',
    status: 503,
    scope: 'upload',
    when: 'The site has used its uploads for this month.',
    retry: 'reset-date',
    response: 'json',
    notes: 'The message names the date uploads resume. The current route does not send Retry-After.',
  },
  {
    code: 'planny_not_configured',
    status: 503,
    scope: 'config',
    when: 'A required environment variable is missing.',
    retry: 'none',
    response: 'both',
    notes: 'The log names the variable. The page and JSON do not. This is not a pause and has no Retry-After.',
  },
  {
    code: 'paused_reads',
    status: 503,
    scope: 'view',
    when: 'The site monthly read count is used up.',
    retry: 'retry-after-and-reset-date',
    response: 'page',
    notes: 'The page names reads and the reset date. Cached views may still serve until their TTL.',
  },
  {
    code: 'paused_bytes',
    status: 503,
    scope: 'view',
    when: 'The site monthly read-byte count is used up.',
    retry: 'retry-after-and-reset-date',
    response: 'page',
    notes: 'The page names plan data read and the reset date.',
  },
  {
    code: 'paused_owner_bytes',
    status: 503,
    scope: 'view',
    when: 'This address has used its monthly read share.',
    retry: 'retry-after-and-reset-date',
    response: 'page',
    notes: 'The page names the address share and the reset date.',
  },
  // 429/503, upload limits
  {
    code: 'address_upload_rate_limited',
    status: 429,
    scope: 'upload',
    when: 'This address uploaded a plan less than 2 minutes ago.',
    retry: 'retry-after',
    response: 'json',
    notes: 'One upload at a time from each address; the header gives the exact seconds to the next slot.',
  },
  {
    code: 'address_upload_daily_limit',
    status: 429,
    scope: 'upload',
    when: 'This address has uploaded 50 plans today.',
    retry: 'retry-after-and-reset-date',
    response: 'json',
    notes: 'Resets at midnight UTC.',
  },
  {
    code: 'address_upload_monthly_limit',
    status: 429,
    scope: 'upload',
    when: 'This address has uploaded 500 plans this month.',
    retry: 'retry-after-and-reset-date',
    response: 'json',
  },
  {
    code: 'site_upload_monthly_limit',
    status: 503,
    scope: 'upload',
    when: 'planny has used its 5,000 uploads for the month.',
    retry: 'retry-after-and-reset-date',
    response: 'json',
    notes: 'Site-wide guard; reads keep working.',
  },
  // Page codes
  {
    code: 'route_not_found',
    status: 404,
    scope: 'view',
    when: 'The path is not a plan, an upload or an admin route.',
    retry: 'none',
    response: 'page',
  },
  {
    code: 'plan_not_found',
    status: 404,
    scope: 'view',
    when: 'The plan id is missing, malformed, unknown, or the path has extra segments.',
    retry: 'none',
    response: 'page',
  },
  {
    code: 'plan_expired',
    status: 410,
    scope: 'view',
    when: 'The plan reached its expiry time.',
    retry: 'reset-date',
    response: 'page',
    notes: 'Shows the plan name and the expiry date.',
  },
  {
    code: 'plan_deleted',
    status: 410,
    scope: 'view',
    when: 'The author deleted the plan.',
    retry: 'none',
    response: 'page',
    notes: 'Never shows the plan name.',
  },
  {
    code: 'plan_removed',
    status: 410,
    scope: 'view',
    when: 'planny took the plan down.',
    retry: 'none',
    response: 'page',
    notes: 'Never shows the plan name.',
  },
  {
    code: 'store_unavailable',
    status: 503,
    scope: 'view',
    when: 'The plan store read or write failed.',
    retry: 'retry-after',
    response: 'both',
    notes: 'Retry-After: 5, no-store. A transient store failure, not plan_not_found and not planny_not_configured.',
  },
  {
    code: 'upload_interrupted',
    status: 500,
    scope: 'upload',
    when: 'The plan was stored but could not be published.',
    retry: 'none',
    response: 'json',
    notes: 'Do not retry. Stop and report; this is a server-side store failure.',
  },
];
