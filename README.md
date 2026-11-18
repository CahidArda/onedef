# onedef

📖 **Docs:** [`apps/docs`](./apps/docs) (Fumadocs). Run `pnpm --filter @onedef/site dev`.

**Define your API once.** Get a backend, a typed client, REST + OpenAPI, a CLI
with login, an MCP server, an MCP App and docs, all from one contract.

```ts
// contract.ts — shipped everywhere. No server code in here.
export const config = defineConfig({ name: 'misrava', auth: { oauth: { scopes: ['profile'] } } })

export const songs = collection(config, {
  name: 'songs',
  description: 'French song lessons.',
  id: 'slug',
  fields: Song,              // the object: what `get` returns
  summary: SongSummary,      // what `list` returns
  create: { input: NewSong },
  delete: true,
  actions: {
    rename: action({ summary: 'Rename a lesson', input: z.object({ title: z.string() }), output: Song, needs: 'object' }),
  },
})

export const account = singleton(config, { name: 'account', description: 'You.', fields: Account })

export const contract = defineApi(config, { songs, account })
```

```ts
// backend.ts — server only. Every handler is type-checked: a missing one is a compile error.
export const backend = implement(contract, {
  context: async ({ request }) => ({ userId: await verify(request) }),
  songs: {
    list: () => db.songs.list(),
    get: async ({ id }) => (await db.songs.get(id)) ?? fail('NOT_FOUND', `No lesson "${id}"`),
    create: ({ input, ctx }) => db.songs.create(input, ctx.userId),
    delete: ({ id }) => db.songs.delete(id),
    rename: ({ object, input }) => db.songs.save({ ...object, title: input.title }), // `object` loaded via get
  },
  account: { get: ({ ctx }) => db.users.get(ctx.userId) },
})
```

Then every surface is one line:

| surface | code |
| --- | --- |
| REST + RPC + `/openapi.json` (Next.js) | `export const { GET, POST } = toNextHandlers(backend)` |
| typed client, web | `createClient(contract, rpc({ url: '/api' }))` |
| typed client, server components | `createClient(contract, local(backend))` |
| MCP server (+ MCP App) | `createMcpHandler(backend)`, plus `{ app }` for the UI |
| CLI with `login` | `runCli(contract, { transport: rpc({ url }) })` |
| docs | `writeMintlifySite(contract, { spec: await generateOpenApi(contract) })` |

The two server surfaces are plain fetch handlers, `(request: Request) => Promise<Response>`,
so they drop into any framework. In Next.js (App Router) they are two route files:

```ts
// app/api/[[...route]]/route.ts — REST, RPC (/api/rpc/*) and /api/openapi.json
import { toNextHandlers } from '@onedef/orpc'
import { backend } from '@/lib/backend'

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = toNextHandlers(backend)
```

```ts
// app/mcp/route.ts — the MCP server at /mcp (Streamable HTTP)
import { createMcpHandler } from '@onedef/mcp'
import { backend } from '@/lib/backend'

const handler = createMcpHandler(backend)   // (request: Request) => Promise<Response>
export { handler as GET, handler as POST, handler as DELETE }
```

Elsewhere: `toFetchHandler(backend)` for Hono, Bun, Deno or a worker, and
`serveMcpStdio(backend)` for a local stdio MCP server.

## Objects

Most APIs are objects, so that's how you write them:

| | ops you get | REST | MCP tools |
| --- | --- | --- | --- |
| `collection()` | `list`, `get`; `create`, `delete` if declared; your `actions` | `GET /songs`, `GET /songs/{slug}`, `POST /songs`, `DELETE /songs/{slug}`, `POST /songs/{slug}/rename` | `songs_list`, `songs_get`, … |
| `singleton()` | `get`; your `actions` | `GET /account`, `POST /account/<action>` | `account_get`, … |

`list` takes parameters like any op, so filters and search are input fields,
and `paginate: 'cursor'` adds `cursor`/`limit` and returns `{ items, nextCursor }`:

```ts
list: { input: z.object({ q: z.string().optional() }), paginate: 'cursor' }
// web:  useInfiniteQuery(q.songs.list.infiniteQueryOptions({ q: 'piaf' }))
// CLI:  misrava songs list --q piaf --limit 20   → table, then "More: … --cursor 20"
```

An action with `needs: 'object'` gets the current object loaded through `get`
on the server: one round trip, the same on every surface. For anything that
isn't an object (search, health checks, batch jobs), `defineService` with plain
`query()` / `mutation()` ops is the escape hatch. Everything compiles down to
those ops.

## Storage is yours (or let a store write it)

`implement()` doesn't care where data lives: your handlers call your database,
an ORM, files, another API. That's the normal case, and nothing below is
required.

When the objects are simple enough to sit in a key-value store,
`implementStore` writes the persistence for you, and you keep only the handlers
that hold logic:

```ts
export const backend = implementStore(contract, fsStore('.data'), {
  songs: {
    create: ({ input }) => ({ slug: slugify(input.title), ...input }),   // the only required handler
    rename: ({ object, input }) => ({ ...object, title: input.title }),  // returns the object → written back
  },
})
```

`list` (with pagination and equality filters), `get` and `delete` are
generated; any of them can be overridden. Stores are `memoryStore()`,
`fsStore(dir)` and `redisStore(redis)` (Upstash), and swapping one for another
changes nothing else. It returns a normal backend, so every surface works
unchanged.

## Processes: let the connected agent do the work

Some work is a sequence of model calls: translate a song in parts, then
assemble it. Mark the mutation `process: true` and write its handler with
`step` and `elicitAgentInput`. Calling the mutation runs it end to end on your server
(with your model); the agent connected over MCP can instead do each step itself.

```ts
// contract: still one mutation, plus a flag
translate: action({ summary: 'Translate the song', needs: 'object', output: Song, process: true }),
```

```ts
// backend: the usual arguments, plus step / elicitAgentInput / headless
implement(contract, {
  songs: {
    translate: async ({ object, step, elicitAgentInput, headless }) => {
      const prompt = await step('prompt', () => buildPrompt(object))            // runs once, replayed after
      const part = headless
        ? await step('part-1', () => openai(prompt))                            // the mutation itself: your model
        : await elicitAgentInput('part-1', { schema: Part, data: { prompt } })  // <op>Start: the agent
      return step('save', () => save(object, part))
    },
  },
}, { runStore: runsIn(fsStore('.data')) })   // required because the contract has a process
```

From the one flag, every surface gets three ops:

| op | MCP tool | what it does |
| --- | --- | --- |
| `songs.translate` | `songs_translate` | runs end to end, headless (`headless: true`): the UI's button |
| `songs.translateStart` | `songs_translate_start` | starts a run the caller answers: `runId` + the first `waitingFor` |
| `songs.translateNext` | `songs_translate_next` | `{ runId, payload }`: the answer to the current step |

`waitingFor` carries instructions, data and the JSON Schema of the expected
answer. An answer that doesn't match is rejected with the reason and the run
stays put. An accepted one moves the run on, until `status: 'done'`. A run
that fails before its first pause (no such song, not signed in) isn't kept:
start answers with that error, like any other op.

The engine is [TanStack Workflow](https://tanstack.com/workflow): the handler
replays on each call with finished steps recorded, so no server holds a run in
memory. That means everything with side effects goes in a `step`.

The engine is [`@onedef/mcp-elicitation-workflow`](./packages/mcp-elicitation-workflow), which works on its
own: its `createWorkflow` (TanStack Workflow, re-exported), `ctx.elicitAgentInput()` for the
agent's turns, `ctx.elicitHumanInput()` for the user's (MCP elicitation, without rerunning the code before the
question), and
`registerWorkflowTool(server, 'deploy', { runStore }, deploy)` to put it on a plain MCP SDK server,
the way `server.registerTool` registers a tool.
[`examples/mcp-workflow`](./examples/mcp-workflow) is that, with an eve agent and evals
CI runs.

Runs live in a `runStore`. `runsIn(store)` puts them in any `@onedef/store`
store (files locally, Redis on serverless), and `memoryRunStore()` is for
tests. `implementStore` keeps them in its own store automatically. The option
is typed: required when the contract has a process, absent otherwise.

## Caching, from the contract

```ts
const q = createQueryUtils(contract, client)          // @onedef/query, TanStack Query v5
useQuery(q.songs.get.queryOptions({ slug }))
useMutation(q.songs.rename.mutationOptions())         // updates songs.get, invalidates songs.list
```

The contract knows which ops read and which write, and which object they
touch, so invalidation needs no hand-written `onSuccess`. Works with the React,
Vue, Solid and Svelte adapters.

## One UI, on the web and inside Claude

The client takes a **transport**, the thing that actually answers a call. On
the web it's `fetch`. Inside an [MCP App](https://modelcontextprotocol.io) it's
a tool call to the host. Pick it with one expression:

```ts
export const client = createClient(contract, mcpApp() ?? rpc({ url: '/api' }))
```

`mcpApp()` returns `undefined` unless the page is running inside an MCP App
(the MCP server marks the HTML it serves, so detection is synchronous). Build
your UI once, with any framework, and the same components deploy to Vercel and
render inside Claude and ChatGPT.

On the server, `createMcpHandler` is a fetch handler,
`(request: Request) => Promise<Response>`. With no options it serves every op
as a tool, and no UI:

```ts
// app/mcp/route.ts
const handler = createMcpHandler(backend)
export { handler as GET, handler as POST, handler as DELETE }
```

To show a UI, pass `app`. The host renders the UI from one self-contained HTML
file that the MCP server hands it as a `ui://` resource. That file is your
build output, so onedef needs to be told where it is. That is what `html` is:
the file's contents, or a function that reads them.

```ts
createMcpHandler(backend, {
  app: {
    html: () => readFile('mcp-app/dist/index.html', 'utf8'),   // your single-file build
    tools: ['songs.get', 'songs.list'],   // calls that open the UI; default: every query
  },
})
```

`tools` is checked against the contract, so `'songs.gte'` is a compile error.
Every tool stays callable from inside the UI either way.

With Next.js you don't build or locate the file yourself. The MCP App is one
file next to your pages, Next builds it, and `serveMcpApp()` fills in `html`:

```ts
// next.config.ts
export default withOnedef(nextConfig)

// app/mcp-app.tsx
export default defineMcpApp(contract, {
  routes: {
    '/': HomeScreen,                                                    // params become props
    '/songs/:slug': { screen: SongScreen, openedBy: ['songs.get'] },   // :slug ← the call's input.slug
  },
})

// app/mcp/route.ts
import { serveMcpApp } from '@onedef/next/server'

const handler = createMcpHandler(backend, { app: serveMcpApp({ tools: ['songs.get'] }) })
export { handler as GET, handler as POST, handler as DELETE }
```

No Vite config, no extra scripts: `next build` produces the single-file app and
traces it into the `/mcp` route, and `next dev` rebuilds it as you edit. An
`openedBy` op the contract lacks, or one whose input doesn't carry the route's params, is a
compile error, and the opening tool's result is seeded into the query cache, so the first
screen renders without a second tool call.

Without Next, `launch(contract)` tells you which tool call opened the app
(`{ service: 'songs', op: 'get', input: { slug } }`), so the UI can route.
The browser side is about 3 kB and has no dependencies.

## With or without backend functions

**With:** handlers live in `implement()`, which only the server imports, so
they can never end up in a client, CLI or SDK bundle. Expose the backend with
`toFetchHandler` / `toNextHandlers` and call it with `rpc()`. MCP can run the
handlers in process (`createMcpHandler(backend)`) or forward to the deployed
backend like any other client (`createMcpHandler(contract, { transport: rpc({ url }) })`).

**Without:** the backend already exists somewhere. Each op says where it lives:

```ts
export const databases = defineService(config, {
  name: 'databases',
  description: 'Your Redis databases.',
  ops: {
    // `list` is the op's name; `query()` declares a read-only op (`mutation()` is for writes)
    list: query({
      summary: 'List databases',
      output: z.array(Database),
      http: { method: 'GET', path: '/v2/redis/databases', errors: { 401: 'UNAUTHORIZED' } },
    }),
  },
})
```

and every surface calls that API directly with `http({ baseUrl })`. There's no
onedef server at all. The two modes mix: an op with an `http` descriptor needs
no handler, and a backend proxies the ones it doesn't implement.

## Auth, declared once

```ts
defineConfig({
  name: 'acme',
  auth: {
    apiKey: { env: 'ACME_API_KEY', url: 'https://acme.dev/settings/keys' },
    oauth: { scopes: ['profile', 'email'] },
  },
})
```

- **CLI**: `acme login` runs the same OAuth flow an MCP client uses: it
  discovers the authorization server from your API, registers with CIMD or
  DCR, and logs in with PKCE in the browser. `acme login --with-token`
  stores an API key. `ACME_API_KEY=… acme …` covers CI.
- **MCP**: `createMcpHandler(backend, { auth: { verify, resourceMetadataUrl } })`
  answers 401 with the discovery header, so Claude/ChatGPT connect with OAuth.
  Clerk, Auth0, WorkOS and Better Auth all plug into `verify`.
- **Clients**: `rpc({ url, auth: () => ({ bearer: token }) })`.

## Packages

| package | what |
| --- | --- |
| `onedef` | contract, `implement`, `createClient`, `local()` and `http()` transports. No dependencies. |
| `@onedef/orpc` | `toFetchHandler`, `toNextHandlers`, `generateOpenApi`; `@onedef/orpc/client` → `rpc()` |
| `@onedef/mcp` | `createMcpHandler`, `serveMcpStdio`; `@onedef/mcp/app` → `mcpApp()`, `launch()` |
| `@onedef/cli` | `runCli` with `login` / `logout` / `whoami`, `toSkillMarkdown` |
| `@onedef/next` | `withOnedef(nextConfig)`: builds the MCP App during `next build` / `next dev` from `app/mcp-app.tsx`; `@onedef/next/server` → `serveMcpApp()`; `@onedef/next/mcp-app` → `defineMcpApp()` with typed routes and launch targets |
| `@onedef/query` | TanStack Query: `queryOptions` / `mutationOptions` with contract-derived keys and automatic invalidation |
| `@onedef/store` | `implementStore(contract, store, handlers)`: list/get/delete generated over a memory, file or Upstash Redis store; process runs kept there too |
| `@onedef/mcp-elicitation-workflow` | standalone (no onedef needed): MCP tools that stop to ask the user (`ctx.elicitHumanInput`, the same API as MCP elicitation) or the agent (`ctx.elicitAgentInput`), and continue where they stopped without rerunning earlier code. `registerWorkflowTool(mcpServer, 'workflow', { runStore }, workflow)`; memory, key-value and Redis run stores |
| `@onedef/process` | the engine behind `process: true` mutations, on `@onedef/mcp-elicitation-workflow`: `runsIn(store)`, `memoryRunStore()` |
| `@onedef/docs` | Mintlify site driven by the OpenAPI document |

Schemas are any [Standard Schema](https://standardschema.dev) validator with
JSON Schema support (zod 4.2 and later, arktype, valibot). Nothing to register.

See [`DESIGN.md`](./DESIGN.md) for the architecture, and `examples/` for the
complete thing.

## Develop

```bash
pnpm install
pnpm build
pnpm test
```
