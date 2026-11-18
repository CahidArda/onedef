import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hrefOf, matchHref, type RouteParams, type Target } from '../src/routes.js'

test('hrefOf fills and encodes params', () => {
  assert.equal(hrefOf({ to: '/songs/:slug', params: { slug: 'a b' } }), '/songs/a%20b')
  assert.equal(hrefOf({ to: '/' }), '/')
  assert.throws(() => hrefOf({ to: '/songs/:slug' }), /needs a "slug" param/)
})

test('matchHref prefers static segments and decodes params', () => {
  const patterns = ['/', '/songs/:slug', '/songs/new', '/learn/:id/lines/:n']
  assert.deepEqual(matchHref(patterns, '/songs/new'), { to: '/songs/new' })
  assert.deepEqual(matchHref(patterns, '/songs/a%20b?x=1'), { to: '/songs/:slug', params: { slug: 'a b' } })
  assert.deepEqual(matchHref(patterns, '/learn/a1/lines/3/'), {
    to: '/learn/:id/lines/:n',
    params: { id: 'a1', n: '3' },
  })
  assert.deepEqual(matchHref(patterns, '/'), { to: '/' })
  assert.equal(matchHref(patterns, '/nope'), undefined)
})

export const _types = () => {
  const p: RouteParams<'/learn/:id/lines/:n'> = { id: 'a', n: '1' }
  type R = { '/': unknown; '/songs/:slug': unknown }
  const ok: Target<R>[] = [{ to: '/' }, { to: '/songs/:slug', params: { slug: 'x' } }]
  // @ts-expect-error missing params
  const noParams: Target<R> = { to: '/songs/:slug' }
  // @ts-expect-error unknown route
  const badRoute: Target<R> = { to: '/nope' }
  // @ts-expect-error wrong param name
  const badParam: Target<R> = { to: '/songs/:slug', params: { id: 'x' } }
  ;(void p, ok, noParams, badRoute, badParam)
}
