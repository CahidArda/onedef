import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineMcpApp } from '../src/mcp-app.js'
import { contract } from './fixture/contract.js'

const Home = () => null
const Song = (_: { slug: string }) => null
const NeedsId = (_: { id: string }) => null

// Compile-time checks only: everything below is exactly what `tsc` must accept or reject.
export const _types = () => {
  const app = defineMcpApp(contract, {
    routes: {
      '/': { screen: Home, openedBy: ['songs.list'] },
      '/songs/:slug': { screen: Song, openedBy: ['songs.get'] }, // :slug ← input.slug
    },
  })

  // names differ: a function per op returns the params
  defineMcpApp(contract, {
    routes: {
      '/': Home,
      '/tracks/:id': {
        screen: NeedsId,
        openedBy: {
          'songs.get': ({ input, result }) => {
            const title: string | undefined = result?.title
            void title
            return { id: input.slug }
          },
        },
      },
    },
  })

  defineMcpApp(contract, {
    // @ts-expect-error no such op in the contract
    routes: { '/': { screen: Home, openedBy: ['songs.nope'] } },
  })

  defineMcpApp(contract, {
    // @ts-expect-error songs.list's input has no `slug` to fill the route's param
    routes: { '/songs/:slug': { screen: Song, openedBy: ['songs.list'] } },
  })

  defineMcpApp(contract, {
    // @ts-expect-error songs.get's input has `slug`, not `id`
    routes: { '/tracks/:id': { screen: NeedsId, openedBy: ['songs.get'] } },
  })

  defineMcpApp(contract, {
    routes: {
      // @ts-expect-error the route's param is `id`, the function returns `slug`
      '/tracks/:id': { screen: NeedsId, openedBy: { 'songs.get': ({ input }) => ({ slug: input.slug }) } },
    },
  })

  defineMcpApp(contract, {
    // @ts-expect-error the screen needs `id`, the pattern gives `slug`
    routes: { '/songs/:slug': NeedsId },
  })

  // typed Link and navigate
  const go = app.useNavigate()
  go({ to: '/songs/:slug', params: { slug: 'a' } })
  // @ts-expect-error params required
  go({ to: '/songs/:slug' })
  void (<app.Link to={{ to: '/' }}>home</app.Link>)
  // @ts-expect-error unknown route
  void (<app.Link to={{ to: '/x' }}>x</app.Link>)
}

test('defineMcpApp types compile (checked by tsc)', () => {})

test('a tool call opens one route: two routes opened by the same op is an error', () => {
  assert.throws(
    () =>
      defineMcpApp(contract, {
        routes: {
          '/': { screen: Home, openedBy: ['songs.get'] },
          '/songs/:slug': { screen: Song, openedBy: ['songs.get'] },
        },
      }),
    /songs\.get opens both \/ and \/songs\/:slug/,
  )
})
