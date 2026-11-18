import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { viteConfig, type ResolvedMcpApp } from '../src/build.js'

const app: ResolvedMcpApp = {
  dir: '/project',
  entry: '/project/app/mcp-app.tsx',
  workDir: '/project/.onedef/mcp-app',
  html: '/project/.onedef/mcp-app/dist/index.html',
  tailwind: false,
}

test('one React and one React Query: always the app’s copies', async () => {
  const config = await viteConfig(app, false)
  assert.deepEqual(config.resolve?.dedupe, ['react', 'react-dom', '@tanstack/react-query'])
})

test('the dev watcher ignores generated folders, so next dev does not trigger rebuild loops', async () => {
  const config = await viteConfig(app, true)
  const exclude = (config.build?.watch as { exclude: string[] }).exclude
  for (const dir of ['**/.next/**', '**/.onedef/**', '**/node_modules/**']) assert.ok(exclude.includes(dir), dir)
  assert.equal((await viteConfig(app, false)).build?.watch, undefined, 'no watcher for next build')
})

test('defaults: single-file output beside the generated page, @/ is the project root, vite escape hatch merges', async () => {
  const config = await viteConfig({ ...app, vite: { define: { EXTRA: '1' } } }, false)
  assert.equal(config.build?.outDir, path.dirname(app.html))
  assert.equal(config.root, app.workDir)
  assert.deepEqual((config.resolve?.alias as unknown as { replacement: string }[])[0]!.replacement, '/project/')
  assert.equal((config.define as Record<string, string>).EXTRA, '1')
  const names = (config.plugins as { name: string }[]).flat().map((plugin) => plugin.name)
  assert.ok(names.includes('vite:singlefile'), names.join(','))
})
