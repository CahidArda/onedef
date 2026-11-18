import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { z } from 'zod'
import { defineApi, defineConfig, defineService, mutation, query } from 'onedef'
// the real router, so the nav is checked against what the server actually serves
import { generateOpenApi } from '../../orpc/src/index.js'
import { toDocsJson, toMintlify, writeMintlifySite } from '../src/index.js'

const config = defineConfig({ name: 'misrava', description: 'French song lessons.' })
const Song = z.object({ slug: z.string(), title: z.string() })
const songs = defineService(config, {
  name: 'songs',
  description: 'Song lessons with {timed} lyrics.',
  id: 'slug',
  ops: {
    list: query({ summary: 'List lessons', output: z.array(Song) }),
    get: query({ on: 'member', summary: 'Get one lesson', output: Song }),
    create: mutation({ summary: 'Create a lesson', input: z.object({ title: z.string() }), output: Song }),
    remove: mutation({ on: 'member', summary: 'Delete a lesson', destructive: true }),
  },
})
const contract = defineApi(config, { songs })

test('nav entries are exactly the routes the router serves', async () => {
  const spec = (await generateOpenApi(contract)) as { paths: Record<string, Record<string, unknown>> }
  const served = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
  )
  const { nav } = toMintlify(contract, { openapi: '/openapi.json', overviews: false })
  assert.deepEqual(nav, [
    {
      group: 'songs',
      openapi: '/openapi.json',
      pages: ['GET /api/songs', 'GET /api/songs/{slug}', 'POST /api/songs', 'POST /api/songs/{slug}/remove'],
    },
  ])
  assert.deepEqual([...nav[0]!.pages].sort(), served.sort())
})

test('overview page: description, summaries, destructive warning, MDX-safe prose', () => {
  const { nav, pages } = toMintlify(contract, { openapi: '/openapi.json' })
  assert.equal(nav[0]!.pages[0], 'api-reference/songs/overview')
  const mdx = pages[0]!.mdx
  assert.match(mdx, /description: "Song lessons with \{timed\} lyrics\."/)
  assert.match(mdx, /Song lessons with \\\{timed\\\} lyrics\./)
  assert.match(mdx, /\*\*Get one lesson\*\* — `GET \/api\/songs\/\{slug\}`/)
  assert.match(mdx, /<Warning>\n {2}\*\*Delete a lesson\*\* cannot be undone\.\n<\/Warning>/)
})

test('docs.json defaults come from the config', () => {
  const docs = toDocsJson(contract, { openapi: '/openapi.json' })
  assert.equal(docs.name, 'misrava')
  assert.equal(docs.description, 'French song lessons.')
})

test('writeMintlifySite writes the site and keeps index.mdx', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'onedef-docs-'))
  try {
    const spec = await generateOpenApi(contract)
    const written = await writeMintlifySite(contract, { dir, spec })
    assert.deepEqual(written.sort(), ['api-reference/songs/overview.mdx', 'docs.json', 'index.mdx', 'openapi.json'])
    await writeFile(join(dir, 'index.mdx'), 'mine')
    assert.equal((await writeMintlifySite(contract, { dir, spec })).includes('index.mdx'), false)
    assert.equal(await readFile(join(dir, 'index.mdx'), 'utf8'), 'mine')
    const docs = JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8'))
    assert.deepEqual(docs.navigation.groups[0], { group: 'Get started', pages: ['index'] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
