import { randomUUID } from 'node:crypto'
import { link, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { ApiError } from 'onedef'
import { pageOfIds, type Store, type StoredObject } from './store.js'

export type { Store, StoredObject, StorePage } from './store.js'

/**
 * Ids and namespace segments that are safe as file names everywhere: letters,
 * digits and `_ - . @ ~ + =`, not starting with a dot, at most 200 characters.
 * No `/`, `\`, `..` or NUL can get through, so a caller-supplied id can never
 * address a file outside the store's directory.
 */
const SAFE = /^[A-Za-z0-9_@~+=-][A-Za-z0-9._@~+=-]{0,199}$/

function safe(value: string, what: string): string {
  if (!SAFE.test(value)) {
    throw new ApiError(
      'INVALID_INPUT',
      `Invalid ${what} ${JSON.stringify(value)}: use letters, digits and _ - . @ ~ + = (not starting with a dot)`,
    )
  }
  return value
}

const isCode = (error: unknown, code: string) => (error as { code?: string } | null)?.code === code

/**
 * A store on the local disk: one pretty-printed JSON file per object at
 * `<dir>/<namespace>/<id>.json`, so you can read and edit your data by hand.
 * Writes go to a temporary file first and are renamed into place (atomic on
 * POSIX file systems); `ifAbsent` writes link the temporary file, which fails
 * if the target exists. Node only — for one process on one machine. Ids are
 * compared case-sensitively, so on case-insensitive disks (macOS, Windows
 * defaults) `A` and `a` are the same object.
 *
 *   implementStore(contract, fsStore('.data'), { … })
 */
export function fsStore(dir: string): Store {
  const root = resolve(dir)
  const folder = (ns: string) => {
    const path = join(root, ...ns.split('/').map((segment) => safe(segment, 'namespace')))
    if (!path.startsWith(root + sep)) throw new ApiError('INVALID_INPUT', `Invalid namespace ${JSON.stringify(ns)}`)
    return path
  }
  const file = (ns: string, id: string) => join(folder(ns), `${safe(id, 'id')}.json`)

  const read = async (path: string): Promise<StoredObject | undefined> => {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as StoredObject
    } catch (error) {
      if (isCode(error, 'ENOENT')) return undefined
      throw error
    }
  }

  return {
    async get(ns, id) {
      return read(file(ns, id))
    },

    async put(ns, id, value, options) {
      const target = file(ns, id)
      const at = folder(ns)
      await mkdir(at, { recursive: true })
      const temp = join(at, `.${id}.${randomUUID()}.tmp`)
      await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
      if (!options?.ifAbsent) {
        await rename(temp, target)
        return true
      }
      try {
        await link(temp, target)
        return true
      } catch (error) {
        if (isCode(error, 'EEXIST')) return false
        throw error
      } finally {
        await unlink(temp).catch(() => {})
      }
    },

    async delete(ns, id) {
      try {
        await unlink(file(ns, id))
        return true
      } catch (error) {
        if (isCode(error, 'ENOENT')) return false
        throw error
      }
    },

    async list(ns, options) {
      let names: string[]
      try {
        names = await readdir(folder(ns))
      } catch (error) {
        if (isCode(error, 'ENOENT')) return { items: [] }
        throw error
      }
      const all = names
        .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort()
      const { ids, nextCursor } = pageOfIds(all, options?.cursor, options?.limit)
      // a file removed between readdir and read is simply gone from this page
      const items = (await Promise.all(ids.map((id) => read(file(ns, id))))).filter(
        (item): item is StoredObject => item !== undefined,
      )
      return nextCursor === undefined ? { items } : { items, nextCursor }
    },
  }
}
