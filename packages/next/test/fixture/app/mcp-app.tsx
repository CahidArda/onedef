import { mcpApp } from '@onedef/mcp/app'
import { defineMcpApp } from '@onedef/next/mcp-app'
import { createQueryUtils } from '@onedef/query'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createClient } from 'onedef'
import { contract } from '../contract'

const q = createQueryUtils(contract, createClient(contract, mcpApp()!))

function Library() {
  const songs = useQuery(q.songs.list.queryOptions())
  return (
    <ul id="library">
      {songs.data?.map((song) => (
        <li key={song.slug}>
          <app.Link to={{ to: '/songs/:slug', params: { slug: song.slug } }}>{song.title}</app.Link>
        </li>
      ))}
    </ul>
  )
}

function Song({ slug }: { slug: string }) {
  const song = useQuery(q.songs.get.queryOptions({ slug }))
  return <h1 id="song">{song.data?.title ?? 'loading'}</h1>
}

const Layout = ({ children }: { children: ReactNode }) => <main data-layout>{children}</main>

const app = defineMcpApp(contract, {
  routes: { '/': Library, '/songs/:slug': { screen: Song, openedBy: ['songs.get'] } },
  layout: Layout,
  document: { title: 'Fixture' },
})

export default app
