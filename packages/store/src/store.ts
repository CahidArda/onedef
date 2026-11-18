/** A stored object: anything that survives `JSON.stringify` / `JSON.parse`. */
export type StoredObject = Record<string, unknown>

/** One page of a namespace, in id order. */
export interface StorePage {
  items: StoredObject[]
  /** Pass back as `cursor` for the next page; absent on the last page. */
  nextCursor?: string
}

/**
 * Where objects live. Small on purpose, so a new one (SQLite, KV, S3…) is an
 * afternoon: four async methods over JSON objects, grouped into namespaces.
 *
 * `implementStore()` uses one namespace per service (the service's key in the
 * contract, plus `/<partition>` when you partition), and the object's id as
 * the key. A singleton is stored under the id `_`.
 */
export interface Store {
  /** The object, or `undefined` when there is none. */
  get(ns: string, id: string): Promise<StoredObject | undefined>
  /**
   * Write the object. With `ifAbsent`, only when no object has that id yet,
   * atomically: resolves `false` (and writes nothing) when one exists.
   * Otherwise always `true`.
   */
  put(ns: string, id: string, value: StoredObject, options?: { ifAbsent?: boolean }): Promise<boolean>
  /** `true` when an object was deleted, `false` when there was none. */
  delete(ns: string, id: string): Promise<boolean>
  /**
   * Objects in ascending id order (byte order), starting after `cursor`.
   * Without `limit`, every remaining object. The cursor is the last id of the
   * previous page, so cursors work across every store.
   */
  list(ns: string, options?: { cursor?: string; limit?: number }): Promise<StorePage>
}

/** Keys after `cursor`, in order, one more than `limit` so the caller knows whether a page follows. */
export function pageOfIds(sorted: string[], cursor: string | undefined, limit: number | undefined) {
  const start = cursor === undefined ? sorted : sorted.filter((id) => id > cursor)
  if (limit === undefined || start.length <= limit) return { ids: start }
  const ids = start.slice(0, limit)
  return { ids, nextCursor: ids[ids.length - 1] }
}

/** A store in process memory: tests, demos, a REPL. Values are copied in and out, as a real store would. */
export function memoryStore(): Store {
  const data = new Map<string, Map<string, string>>()
  const bucket = (ns: string) => {
    let map = data.get(ns)
    if (!map) data.set(ns, (map = new Map()))
    return map
  }
  return {
    async get(ns, id) {
      const raw = data.get(ns)?.get(id)
      return raw === undefined ? undefined : (JSON.parse(raw) as StoredObject)
    },
    async put(ns, id, value, options) {
      const map = bucket(ns)
      if (options?.ifAbsent && map.has(id)) return false
      map.set(id, JSON.stringify(value))
      return true
    },
    async delete(ns, id) {
      return data.get(ns)?.delete(id) ?? false
    },
    async list(ns, options) {
      const map = data.get(ns)
      if (!map) return { items: [] }
      const { ids, nextCursor } = pageOfIds([...map.keys()].sort(), options?.cursor, options?.limit)
      const items = ids.map((id) => JSON.parse(map.get(id)!) as StoredObject)
      return nextCursor === undefined ? { items } : { items, nextCursor }
    },
  }
}
