import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { injectMarker } from '@onedef/mcp'
import { withOnedef } from '../src/index.js'
import { serveMcpApp } from '../src/server.js'

const fixture = fileURLToPath(new URL('./fixture', import.meta.url))
const src = fileURLToPath(new URL('../src/mcp-app.tsx', import.meta.url))
const built = path.join(fixture, '.onedef/mcp-app/dist/index.html')

// The package cannot import itself by name from inside its own repo, so the
// test points `@onedef/next/mcp-app` at the source — through the `vite`
// escape hatch, which is also what this exercises.
const options = {
  dir: fixture,
  mcpApp: { vite: { resolve: { alias: [{ find: '@onedef/next/mcp-app', replacement: src }] } } },
}

test('without an entry file the wrapper changes nothing', async () => {
  const config = { reactStrictMode: true }
  const out = await withOnedef(config, { dir: path.join(fixture, 'app') })('phase-production-build', {
    defaultConfig: {},
  })
  assert.deepEqual(out, config)
})

test('next build: builds one self-contained file, traces it into /mcp, and serveMcpApp() finds it', async () => {
  await rm(path.join(fixture, '.onedef'), { recursive: true, force: true })
  delete process.env.__ONEDEF_MCP_APP_STARTED
  const config = await withOnedef(
    async () => ({ outputFileTracingIncludes: { '/mcp': ['./other.json'] }, env: { KEEP: '1' } }),
    options,
  )('phase-production-build', { defaultConfig: {} })

  assert.deepEqual(config.outputFileTracingIncludes, { '/mcp': ['./other.json', './.onedef/mcp-app/dist/index.html'] })
  assert.deepEqual(config.env, { KEEP: '1', ONEDEF_MCP_APP_HTML: '.onedef/mcp-app/dist/index.html' })

  const html = await readFile(built, 'utf8')
  assert.doesNotMatch(html, /<script[^>]+src=/, 'scripts are inlined')
  assert.match(html, /<script type="module"/)
  assert.ok(existsSync(path.join(fixture, '.onedef/mcp-app/.gitignore')), 'generated folder ignores itself')

  const resource = serveMcpApp({ file: built, tools: ['songs.get'] })
  assert.deepEqual(resource.tools, ['songs.get'])
  assert.equal(await (resource.html as () => Promise<string>)(), html)

  // a second load in the same process tree (a build worker) does not rebuild
  const again = await withOnedef({}, options)('phase-production-build', { defaultConfig: {} })
  assert.ok(again.outputFileTracingIncludes)
})

test('serveMcpApp() explains a missing build', async () => {
  const resource = serveMcpApp({ file: path.join(fixture, 'missing.html') })
  await assert.rejects((resource.html as () => Promise<string>)(), /not built/)
})

/** Chromium, if this machine has Playwright installed globally; the render test needs a browser. */
function playwright(): { chromium: { launch(): Promise<any> } } | undefined {
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
    return createRequire(import.meta.url)(path.join(root, 'playwright'))
  } catch {
    return undefined
  }
}

test('renders in an MCP host: openedBy picks the route, the result seeds the cache, Link navigates', async (t) => {
  const pw = playwright()
  if (!pw) return t.skip('playwright is not installed')
  const html = injectMarker(await readFile(built, 'utf8'))
  const browser = await pw.chromium.launch()
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error: Error) => errors.push(String(error)))
    await page.setContent('<body></body>')
    // One fake MCP host per iframe: answers the handshake, optionally says
    // which tool call opened the app, and serves tools/call from a fixture.
    // plain strings, not functions: tsx's transform would inject helpers the page lacks
    await page.evaluate(`window.__app = ${JSON.stringify(html)}`)
    await page.evaluate(`{
      const songs = [
        { slug: 'a', title: 'Aye' },
        { slug: 'b', title: 'Bee' },
      ]
      const result = (value) => ({
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: Array.isArray(value) ? { result: value } : value,
        ...(Array.isArray(value) ? { _meta: { 'onedef/wrapped': true } } : {}),
      })
      const calls = (window.__calls = {})
      ;window.__host = (id, opened) => {
        const frame = document.createElement('iframe')
        frame.id = id
        frame.style.cssText = 'width:600px;height:300px'
        document.body.append(frame)
        calls[id] = []
        window.addEventListener('message', (event) => {
          if (event.source !== frame.contentWindow) return
          const msg = event.data
          if (!msg || msg.jsonrpc !== '2.0') return
          const post = (data) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...data }, '*')
          if (msg.method === 'ui/initialize') {
            const toolInfo = opened ? { toolInfo: { tool: { name: opened.tool } } } : {}
            post({ id: msg.id, result: { protocolVersion: '2026-01-26', hostContext: { theme: 'dark', ...toolInfo } } })
          } else if (msg.method === 'ui/notifications/initialized' && opened) {
            post({ method: 'ui/notifications/tool-input', params: { arguments: opened.input } })
            post({ method: 'ui/notifications/tool-result', params: result(opened.result) })
          } else if (msg.method === 'tools/call') {
            calls[id].push(msg.params.name)
            const { slug } = msg.params.arguments ?? {}
            const value = msg.params.name === 'songs_list' ? songs : songs.find((s) => s.slug === slug)
            post({ id: msg.id, result: result(value) })
          } else if (msg.id !== undefined && msg.method) {
            post({ id: msg.id, result: {} })
          }
        })
        frame.srcdoc = window.__app
      }
}`)

    // opened by songs_get: launch picks the song route, and its result is the screen's data
    await page.evaluate(() =>
      (window as any).__host('opened', {
        tool: 'songs_get',
        input: { slug: 'b' },
        result: { slug: 'b', title: 'Bee' },
      }),
    )
    const opened = page.frameLocator('#opened')
    await opened.locator('#song').filter({ hasText: 'Bee' }).waitFor({ timeout: 10_000 })
    assert.deepEqual(await page.evaluate('__calls.opened'), [], 'no tool call: the cache was seeded')
    assert.equal(await opened.locator('[data-layout]').count(), 1, 'the layout wraps the screen')
    assert.equal(await opened.locator('html').getAttribute('class'), 'dark', 'the host theme is applied')
    assert.equal(await opened.locator('title').textContent(), 'Fixture')

    // opened by nothing: the fallback route, then a typed Link navigates with a real tool call
    await page.evaluate(`__host('plain')`)
    const plain = page.frameLocator('#plain')
    await plain.getByText('Aye').click({ timeout: 10_000 })
    await plain.locator('#song').filter({ hasText: 'Aye' }).waitFor({ timeout: 10_000 })
    assert.deepEqual(await page.evaluate('__calls.plain'), ['songs_list', 'songs_get'])
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
