// Atomic steps shared by both builds. The local build runs them with fengari, Vercel runs
// them with Upstash EVAL. Each script touches only KEYS and ARGV, so its steps never interleave.

const RESERVE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'exists' end
local bytes = tonumber(ARGV[1])
if tonumber(redis.call('GET', KEYS[2]) or '0') + bytes > tonumber(ARGV[2]) then return 'site_budget' end
if tonumber(redis.call('GET', KEYS[3]) or '0') + bytes > tonumber(ARGV[3]) then return 'owner_budget' end
if tonumber(redis.call('GET', KEYS[4]) or '0') + 1 > tonumber(ARGV[4]) then return 'monthly_uploads' end
redis.call('INCRBY', KEYS[2], ARGV[1])
redis.call('INCRBY', KEYS[3], ARGV[1])
redis.call('INCRBY', KEYS[4], 1)
for i = 7, #ARGV, 2 do
  redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('ZADD', KEYS[5], ARGV[6], ARGV[5])
return 'ok'
`;

const PUBLISH = `
if redis.call('HGET', KEYS[1], 'state') ~= 'pending' then return 'not_pending' end
if redis.call('HGET', KEYS[1], 'claimId') ~= ARGV[2] then return 'stolen' end
redis.call('HSET', KEYS[1], 'state', 'live', 'claimId', '', 'claimAt', '0', 'reason', '')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
return 'ok'
`;

const CLAIM = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'missing' end
if state == 'gone' then return 'gone' end
if state == 'pending' or state == 'removing' then
  if tonumber(redis.call('HGET', KEYS[1], 'claimAt') or '0') > tonumber(ARGV[5]) then return 'busy' end
end
if state == 'live' and ARGV[4] == 'expired' then
  if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') > tonumber(ARGV[3]) then return 'not_expired' end
end
if ARGV[4] == 'takedown' then redis.call('HSET', KEYS[1], 'hidden', '1') end
redis.call('HSET', KEYS[1], 'state', 'removing', 'claimId', ARGV[2], 'claimAt', ARGV[3], 'removedAt', ARGV[3], 'reason', ARGV[4])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 'ok'
`;

const FINISH = `
if redis.call('HGET', KEYS[1], 'state') ~= 'removing' then return 'not_removing' end
if redis.call('HGET', KEYS[1], 'claimId') ~= ARGV[2] then return 'stolen' end
local size = redis.call('HGET', KEYS[1], 'bytes') or '0'
if tonumber(size) > 0 then
  redis.call('DECRBY', KEYS[2], size)
  redis.call('DECRBY', KEYS[3], size)
end
redis.call('HSET', KEYS[1], 'state', 'gone', 'claimId', '', 'claimAt', '0', 'bytes', '0')
redis.call('ZREM', KEYS[4], ARGV[1])
return 'ok'
`;

const RATE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return tostring(n)
`;

const CONSUME = `
local reads = tonumber(redis.call('GET', KEYS[1]) or '0')
if reads + 1 > tonumber(ARGV[1]) then return 'reads' end
local read_bytes = tonumber(redis.call('GET', KEYS[2]) or '0')
if read_bytes + tonumber(ARGV[3]) > tonumber(ARGV[2]) then return 'bytes' end
redis.call('INCRBY', KEYS[1], 1)
redis.call('INCRBY', KEYS[2], ARGV[3])
return 'ok'
`;

export const SCRIPTS = {
  reserve: RESERVE,
  publish: PUBLISH,
  claim: CLAIM,
  finish: FINISH,
  rate: RATE,
  consume: CONSUME,
};
