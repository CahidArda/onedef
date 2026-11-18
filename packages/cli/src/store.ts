import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// Types only, and never re-exported: the public .d.ts must not reference an
// optional peer that an API-key-only CLI never installs.
import type { OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client'

/** What `login` leaves behind for one resource. */
export interface StoredEntry {
  apiKey?: string
  oauth?: OAuthEntry
}

export interface OAuthEntry {
  tokens?: StoredOAuthTokens
  /** Epoch ms. Token responses only carry a relative `expires_in`, which is useless once written to disk. */
  expiresAt?: number
  /** The registered (DCR) or URL-based (CIMD) client — reused so a refresh, or a later login, does not re-register. */
  client?: StoredOAuthClientInformation
  /** Discovery results, so a refresh does not repeat RFC 9728/8414 discovery. */
  discovery?: OAuthDiscoveryState
  /** The loopback redirect the tokens were issued for; refresh needs a redirect URL to stay on the interactive path. */
  redirectUri?: string
}

interface StoreFile {
  version: 1
  /** Keyed by the resource URL, so one binary can hold logins for prod and staging side by side. */
  resources: Record<string, StoredEntry>
}

/**
 * One JSON file per binary. Secrets live here, so the directory is 0700 and
 * the file 0600, and every write goes through a temp file and a rename: a
 * crash mid-write must never leave a half-written file that logs the user out
 * (or worse, a world-readable one).
 */
export function credentialStore(path: string) {
  const dir = join(path, '..')
  const load = (): StoreFile => {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoreFile
      return parsed?.resources ? parsed : { version: 1, resources: {} }
    } catch {
      return { version: 1, resources: {} }
    }
  }
  const save = (file: StoreFile) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    try {
      writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
      renameSync(tmp, path)
    } finally {
      rmSync(tmp, { force: true })
    }
  }
  return {
    path,
    read: (resource: string): StoredEntry | undefined => load().resources[resource],
    /** Replace one resource's entry; `undefined` deletes it. */
    write(resource: string, entry: StoredEntry | undefined) {
      const file = load()
      if (entry) file.resources[resource] = entry
      else delete file.resources[resource]
      save(file)
    },
  }
}

export type CredentialStore = ReturnType<typeof credentialStore>
