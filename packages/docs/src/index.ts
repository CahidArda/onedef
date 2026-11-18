import { navEntry, routeOf, type AnyService, type Api } from 'onedef'

export interface DocPage {
  /** Path relative to the docs root, without extension. */
  path: string
  title: string
  mdx: string
}

/**
 * A `navigation.groups` entry. `openapi` points at the spec; `pages` mixes
 * hand-written page paths with `"GET /api/songs"` operation references, which
 * Mintlify expands into generated pages complete with the API playground.
 */
export interface NavGroup {
  group: string
  openapi?: string
  pages: (string | NavGroup)[]
}

export interface MintlifyOutput {
  /** Splice into `docs.json` → `navigation.groups` (or a tab's `groups`). */
  nav: NavGroup[]
  /** Overview pages only — the endpoint pages come from the spec. */
  pages: DocPage[]
}

export type MintlifyTheme = 'mint' | 'maple' | 'palm' | 'willow' | 'linden' | 'almond' | 'aspen' | 'luma' | 'sequoia'

/** A complete `docs.json`. `theme`, `name` and `colors` are required by Mintlify. */
export interface DocsJson {
  $schema: string
  theme: MintlifyTheme
  name: string
  description?: string
  colors: { primary: string; light?: string; dark?: string }
  favicon?: string
  navigation: { groups: NavGroup[] }
}

export interface DocsOptions {
  /** Path of the OpenAPI document, as `docs.json` will reference it, e.g. `/openapi.json`. */
  openapi: string
  /** Directory for the overview pages. Default `api-reference`. */
  base?: string
  /**
   * Path prefix the spec's paths carry. Default `/api`, matching
   * `toFetchHandler` and `generateOpenApi` — pass the same value to all three,
   * or the nav references point at operations the spec does not have.
   */
  prefix?: string
  /** Emit a per-service overview page before its operations. Default true. */
  overviews?: boolean
}

export interface DocsJsonOptions extends DocsOptions {
  /** Default: `config.name`. */
  name?: string
  /** Default: `config.description`. */
  description?: string
  theme?: MintlifyTheme
  colors?: { primary: string; light?: string; dark?: string }
  favicon?: string
  /** Hand-written groups placed before the generated API reference. */
  groups?: NavGroup[]
}

// frontmatter is YAML on one line: collapse whitespace and escape quotes
const yaml = (value: string) => `"${value.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
// in MDX, `{` starts an expression and `<` a component: prose must escape them
const prose = (value: string) => value.replace(/[{}<>]/g, (char) => `\\${char}`)

function overview(svc: AnyService, path: string, prefix: string): DocPage {
  const ops = Object.entries(svc.ops).map(([name, op]) => ({ op, route: routeOf(svc, name, op, prefix) }))
  const destructive = ops.filter(({ op }) => op.destructive)
  const mdx = [
    '---',
    `title: ${yaml(svc.name)}`,
    `description: ${yaml(svc.description)}`,
    '---',
    '',
    prose(svc.description),
    '',
    '## Operations',
    '',
    ...ops.map(({ op, route }) => `- **${prose(op.summary)}** — \`${navEntry(route)}\``),
    '',
    ...(destructive.length
      ? [
          '<Warning>',
          `  ${destructive.map(({ op }) => `**${prose(op.summary)}**`).join(', ')} cannot be undone.`,
          '</Warning>',
          '',
        ]
      : []),
  ].join('\n')
  return { path, title: svc.name, mdx }
}

/**
 * Drive Mintlify from the OpenAPI document rather than hand-written
 * `<ParamField>` pages. The spec already carries every parameter, response
 * and header, so MDX for them would duplicate it, drift from it, and lose the
 * playground. Nav entries are `GET /api/songs/{slug}` references built with
 * the same `routeOf` the router serves, so they always resolve.
 *
 * What stays MDX is what the spec cannot say: a per-service overview.
 */
export function toMintlify(api: Api, options: DocsOptions): MintlifyOutput {
  const base = options.base ?? 'api-reference'
  const prefix = options.prefix ?? '/api'
  const nav: NavGroup[] = []
  const pages: DocPage[] = []
  for (const svc of Object.values(api.services)) {
    const entries: string[] = []
    if (options.overviews ?? true) {
      const page = overview(svc, `${base}/${svc.name}/overview`, prefix)
      pages.push(page)
      entries.push(page.path)
    }
    for (const [name, op] of Object.entries(svc.ops)) entries.push(navEntry(routeOf(svc, name, op, prefix)))
    nav.push({ group: svc.name, openapi: options.openapi, pages: entries })
  }
  return { nav, pages }
}

/**
 * A complete, runnable `docs.json`. Use it for a site onedef owns end to end;
 * to splice the API reference into a site with its own config, take
 * `toMintlify().nav` instead.
 */
export function toDocsJson(api: Api, options: DocsJsonOptions): DocsJson {
  const description = options.description ?? api.config.description
  return {
    $schema: 'https://mintlify.com/docs.json',
    theme: options.theme ?? 'mint',
    name: options.name ?? api.config.name,
    ...(description ? { description } : {}),
    colors: options.colors ?? { primary: '#16A34A' },
    ...(options.favicon ? { favicon: options.favicon } : {}),
    navigation: { groups: [...(options.groups ?? []), ...toMintlify(api, options).nav] },
  }
}

export interface WriteSiteOptions extends Omit<DocsJsonOptions, 'openapi'> {
  /** Directory to write the site into. Created if missing; never deleted. */
  dir: string | URL
  /**
   * The OpenAPI document to publish — `generateOpenApi(contract)` from
   * `@onedef/orpc`, the same router the server runs, so the docs cannot drift
   * from the deployed API. This package only lays the site out; it has no
   * spec builder of its own on purpose.
   */
  spec: Record<string, unknown>
}

/**
 * Write a complete Mintlify site: `openapi.json`, `docs.json`, the overview
 * pages and a starter `index.mdx`.
 *
 * Only generated output (`docs.json`, the spec, the `base` directory) is
 * rewritten. `index.mdx` is created once and then left alone — it is yours.
 * The site directory itself is never removed, so regenerating cannot pull the
 * cwd out from under an open shell. Returns the paths written.
 */
export async function writeMintlifySite(api: Api, options: WriteSiteOptions): Promise<string[]> {
  const { access, mkdir, rm, writeFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const root = typeof options.dir === 'string' ? options.dir : fileURLToPath(options.dir)
  const base = options.base ?? 'api-reference'
  const site = { ...options, openapi: '/openapi.json' }
  const name = options.name ?? api.config.name
  const description = options.description ?? api.config.description ?? `${name} API reference.`

  await mkdir(root, { recursive: true })
  await rm(join(root, base), { recursive: true, force: true })

  const written: string[] = []
  const write = async (path: string, body: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), body)
    written.push(path)
  }
  await write('openapi.json', JSON.stringify(options.spec, null, 2))
  await write(
    'docs.json',
    JSON.stringify(
      toDocsJson(api, { ...site, groups: options.groups ?? [{ group: 'Get started', pages: ['index'] }] }),
      null,
      2,
    ),
  )
  for (const page of toMintlify(api, site).pages) await write(`${page.path}.mdx`, page.mdx)

  const index = join(root, 'index.mdx')
  if (
    !(await access(index).then(
      () => true,
      () => false,
    ))
  ) {
    await write(
      'index.mdx',
      `---\ntitle: ${yaml(name)}\ndescription: ${yaml(description)}\n---\n\n${prose(description)}\n\nThis page is yours: the generator writes it once and never touches it again.\n`,
    )
  }
  return written
}
