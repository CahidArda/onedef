import type { Store, StoredObject } from './store.js'

export type { Store, StoredObject, StorePage } from './store.js'

/**
 * The part of the `@upstash/redis` client the store uses. An `@upstash/redis`
 * `Redis` instance satisfies it as is; anything else with the same commands
 * (a test fake, an adapter over another client) works too.
 */
export interface RedisClient {
  hget(key: string, field: string): Promise<unknown>
  hmget(key: string, ...fields: string[]): Promise<Record<string, unknown> | null>
  hsetnx(key: string, field: string, value: string): Promise<0 | 1>
  zadd(key: string, scoreMember: { score: number; member: string }): Promise<number | null>
  zrange(
    key: string,
    min: `(${string}` | '-',
    max: '+',
    options: { byLex: true; offset: number; count: number },
  ): Promise<unknown[]>
  /** A transaction: commands queue up and run atomically in one request on `exec()`. */
  multi(): {
    hset(key: string, kv: Record<string, string>): unknown
    hdel(key: string, ...fields: string[]): unknown
    zadd(key: string, scoreMember: { score: number; member: string }): unknown
    zrem(key: string, ...members: string[]): unknown
    exec(): Promise<unknown[]>
  }
}

export interface RedisStoreOptions {
  /** Prepended to every key, so several apps (or test runs) can share a database. Default `onedef:`. */
  prefix?: string
}

/** The most ids fetched per ZRANGE when listing a whole namespace. */
const BATCH = 1000

/**
 * A store in Redis, through `@upstash/redis` (HTTP, so it works on Vercel,
 * Cloudflare Workers and any edge runtime). Each namespace is two keys:
 *
 *   <prefix><ns>       hash        id → the object as JSON
 *   <prefix><ns>:ids   sorted set  every id at score 0, so ZRANGE BYLEX lists in id order
 *
 * Writes and deletes update both in one MULTI transaction (one request);
 * `ifAbsent` writes use HSETNX, so two concurrent creates of one id can never
 * both succeed.
 *
 *   import { Redis } from '@upstash/redis'
 *   implementStore(contract, redisStore(Redis.fromEnv()), { … })
 */
export function redisStore(redis: RedisClient, options: RedisStoreOptions = {}): Store {
  const prefix = options.prefix ?? 'onedef:'
  const hash = (ns: string) => `${prefix}${ns}`
  const index = (ns: string) => `${prefix}${ns}:ids`
  // @upstash/redis parses JSON-looking replies by default (`automaticDeserialization`);
  // accept both the parsed object and the raw string so either setting works
  const decode = (raw: unknown): StoredObject | undefined =>
    raw === null || raw === undefined
      ? undefined
      : typeof raw === 'string'
        ? (JSON.parse(raw) as StoredObject)
        : (raw as StoredObject)

  return {
    async get(ns, id) {
      return decode(await redis.hget(hash(ns), id))
    },

    async put(ns, id, value, opts) {
      const json = JSON.stringify(value)
      if (opts?.ifAbsent) {
        if ((await redis.hsetnx(hash(ns), id, json)) === 0) return false
        await redis.zadd(index(ns), { score: 0, member: id })
        return true
      }
      const tx = redis.multi()
      tx.hset(hash(ns), { [id]: json })
      tx.zadd(index(ns), { score: 0, member: id })
      await tx.exec()
      return true
    },

    async delete(ns, id) {
      const tx = redis.multi()
      tx.hdel(hash(ns), id)
      tx.zrem(index(ns), id)
      const [deleted] = await tx.exec()
      return Number(deleted) > 0
    },

    async list(ns, opts) {
      const ids: string[] = []
      let cursor = opts?.cursor
      let more = false
      for (;;) {
        const want = opts?.limit === undefined ? BATCH : opts.limit + 1 - ids.length
        // members can come back as numbers ("42" parses as JSON), so normalise
        const batch = (
          await redis.zrange(index(ns), cursor === undefined ? '-' : `(${cursor}`, '+', {
            byLex: true,
            offset: 0,
            count: want,
          })
        ).map(String)
        ids.push(...batch)
        if (opts?.limit !== undefined) {
          more = ids.length > opts.limit
          if (more) ids.length = opts.limit
          break
        }
        if (batch.length < want) break
        cursor = batch[batch.length - 1]
      }
      if (ids.length === 0) return { items: [] }
      const values = (await redis.hmget(hash(ns), ...ids)) ?? {}
      const items = ids.map((id) => decode(values[id])).filter((item): item is StoredObject => item !== undefined)
      return more ? { items, nextCursor: ids[ids.length - 1]! } : { items }
    },
  }
}
