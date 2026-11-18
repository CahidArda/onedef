/**
 * Runs in Redis (Upstash): for serverless deploys, where the request that
 * starts a run and the one that continues it may land on different instances.
 *
 *   <prefix>run:<runId>:state    the run's current state (JSON)
 *   <prefix>run:<runId>:events   the log (a list of JSON events)
 *
 * The engine appends with compare-and-set ("only if the log has n entries"),
 * which a Lua script makes atomic. Keys expire `ttlSeconds` after a run's last
 * write, so abandoned runs do not pile up.
 */
import { LogConflictError, type RunState, type RunStore, type WorkflowEvent } from '@tanstack/workflow-core'

/** What the store needs from a Redis client. A `Redis` instance from `@upstash/redis` fits as it is. */
export interface RunRedisClient {
  get(key: string): Promise<unknown>
  set(key: string, value: string, options?: { ex: number }): Promise<unknown>
  del(...keys: string[]): Promise<number>
  lrange(key: string, start: number, end: number): Promise<unknown[]>
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>
}

export interface RedisRunStoreOptions {
  /** Prepended to every key. Default `onedef:`. */
  prefix?: string
  /** Seconds a run is kept after its last write. Default 7 days. */
  ttlSeconds?: number
}

const APPEND = `
if redis.call('LLEN', KEYS[1]) ~= tonumber(ARGV[1]) then return 0 end
redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1`

// @upstash/redis parses JSON values by default; a raw client returns strings
const parse = <T>(value: unknown): T | undefined =>
  value === null || value === undefined ? undefined : ((typeof value === 'string' ? JSON.parse(value) : value) as T)

export function redisRunStore(redis: RunRedisClient, options: RedisRunStoreOptions = {}): RunStore {
  const prefix = options.prefix ?? 'onedef:'
  const ttl = options.ttlSeconds ?? 7 * 24 * 60 * 60
  const state = (runId: string) => `${prefix}run:${runId}:state`
  const events = (runId: string) => `${prefix}run:${runId}:events`
  return {
    getRunState: async (runId) => parse<RunState>(await redis.get(state(runId))),
    setRunState: async (runId, value) => void (await redis.set(state(runId), JSON.stringify(value), { ex: ttl })),
    deleteRun: async (runId) => void (await redis.del(state(runId), events(runId))),
    async appendEvent(runId, expectedNextIndex, event) {
      const ok = await redis.eval(APPEND, [events(runId)], [expectedNextIndex, JSON.stringify(event), ttl])
      if (Number(ok) !== 1) {
        const [existing] = await redis.lrange(events(runId), expectedNextIndex, expectedNextIndex)
        throw new LogConflictError(runId, expectedNextIndex, parse<WorkflowEvent>(existing))
      }
    },
    getEvents: async (runId) => (await redis.lrange(events(runId), 0, -1)).map((event) => parse<WorkflowEvent>(event)!),
  }
}
