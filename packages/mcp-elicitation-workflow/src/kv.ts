/**
 * The engine's log on a plain key-value store, so runs can live wherever the
 * app's objects already do (`@onedef/store`'s fs, Redis and memory stores, or
 * any store with the same four methods):
 *
 *   runStore: kvRunStore(fsStore('.data'))
 *
 *   <ns>            <runId>       the run's current state
 *   <ns>/<runId>    000000042     one entry per log event, ids in log order
 *
 * The engine appends with compare-and-set ("only if the log has n entries").
 * Writing event n with `ifAbsent` is exactly that: it fails when another
 * writer got there first. Nothing else needs to be atomic.
 */
import { LogConflictError, type RunState, type RunStore, type WorkflowEvent } from '@tanstack/workflow-core'

type Value = Record<string, unknown>

/** What a run store needs from a key-value store. Every `@onedef/store` store fits as it is. */
export interface RunKv {
  get(ns: string, id: string): Promise<Value | undefined>
  /** With `ifAbsent`: write only if no value has that id yet, atomically; `false` when one did. */
  put(ns: string, id: string, value: Value, options?: { ifAbsent?: boolean }): Promise<boolean>
  delete(ns: string, id: string): Promise<boolean>
  /** Every value of a namespace, in ascending id order. */
  list(ns: string): Promise<{ items: Value[] }>
}

const pad = (index: number) => String(index).padStart(9, '0')

/** A TanStack `RunStore` on any key-value store. Runs live under `namespace` (default `_runs`). */
export function kvRunStore(kv: RunKv, options: { namespace?: string } = {}): RunStore {
  const ns = options.namespace ?? '_runs'
  const events = (runId: string) => `${ns}/${runId}`
  return {
    getRunState: async (runId) => (await kv.get(ns, runId)) as RunState | undefined,
    setRunState: async (runId, state) => void (await kv.put(ns, runId, state as unknown as Value)),
    async deleteRun(runId) {
      const log = (await kv.list(events(runId))).items
      await Promise.all(log.map((_, index) => kv.delete(events(runId), pad(index))))
      await kv.delete(ns, runId)
    },
    async appendEvent(runId, expectedNextIndex, event) {
      if (!(await kv.put(events(runId), pad(expectedNextIndex), event as unknown as Value, { ifAbsent: true }))) {
        const existing = await kv.get(events(runId), pad(expectedNextIndex))
        throw new LogConflictError(runId, expectedNextIndex, existing as unknown as WorkflowEvent)
      }
    },
    getEvents: async (runId) => (await kv.list(events(runId))).items as unknown as WorkflowEvent[],
  }
}

/** A key-value store in a Map — what `memoryRunStore()` keeps runs in. No timers, so processes can exit. */
export function memoryKv(): RunKv {
  const data = new Map<string, Map<string, string>>()
  return {
    get: async (ns, id) => {
      const raw = data.get(ns)?.get(id)
      return raw === undefined ? undefined : (JSON.parse(raw) as Value)
    },
    put: async (ns, id, value, options) => {
      let map = data.get(ns)
      if (!map) data.set(ns, (map = new Map()))
      if (options?.ifAbsent && map.has(id)) return false
      map.set(id, JSON.stringify(value))
      return true
    },
    delete: async (ns, id) => data.get(ns)?.delete(id) ?? false,
    list: async (ns) => {
      const map = data.get(ns)
      const ids = [...(map?.keys() ?? [])].sort()
      return { items: ids.map((id) => JSON.parse(map!.get(id)!) as Value) }
    },
  }
}
