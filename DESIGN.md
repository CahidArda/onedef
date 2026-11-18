# onedef — design

One **contract** describes the API. Everything else is the contract plus a
**transport** (who answers a call), or the contract plus an **implementation**
(how the server answers it).

```
contract  ──┬── implement(contract, handlers)  → backend      (server only)
            │
            ├── createClient(contract, transport) → typed client (web, SDK, server components)
            ├── runCli(contract, { transport, auth })            (CLI)
            ├── createMcpHandler(backend | contract, { app })     (MCP, optional MCP App)
            ├── toFetchHandler(backend)  → REST + RPC + /openapi.json  (oRPC under the hood)
            └── toMintlify / writeMintlifySite                   (docs)
```

## Two ways to have a backend

**1. With backend functions.** The contract is shipped everywhere; the handlers
are attached on the server with `implement()` and never imported by a client,
CLI or SDK bundle. Expose the backend with `toFetchHandler(backend)` (oRPC
RPC + REST + OpenAPI). Clients call it with the `rpc({ url })` transport. MCP
can either run the handlers in process (`createMcpHandler(backend)`) or forward
to the exposed backend like any other client
(`createMcpHandler(contract, { transport: rpc({ url }) })`).

**2. Without backend functions.** The backend already exists somewhere (any
REST API). Each op carries an `http` descriptor saying where it lives. Clients,
the CLI and MCP call it directly with the `http({ baseUrl })` transport. No
onedef server exists at all.

The two mix: an op with an `http` descriptor needs no handler; `implement()`
falls back to the descriptor (proxy) for ops it does not implement.

## Contract

```ts
export const config = defineConfig({ name: 'misrava', scopes: {...}, modes: [...] })

export const songs = defineService(config, {
  name: 'songs',
  description: 'French song lessons.',
  id: 'slug',                       // the field member ops are addressed by
  ops: {
    list:      query({ summary: 'List lessons', output: z.array(SongSummary) }),
    get:       query({ on: 'member', summary: 'Get one lesson', output: SongRecord }),
    create:    mutation({ summary: 'Create a lesson', input: CreateInput, output: SongSummary }),
    setOffset: mutation({ on: 'member', summary: '...', input: z.object({ offsetMs: z.number() }) }),
  },
})

export const contract = defineApi(config, { songs })
```

- `query` = read-only (GET, MCP readOnlyHint, no CLI confirmation).
- `mutation` = side effects (POST by default; `destructive` → MCP
  destructiveHint + CLI `--yes`).
- `on: 'collection'` (default) or `'member'` (addressed by `id`; the id is a
  field of the input on every surface: `client.songs.get({ slug })`).
- Optional per op: `input`, `output`, `description`, `http` (descriptor),
  `scope: ['team']`, `modes: ['apikey']`, `destructive`, `idempotent`,
  `route: { method, path }`, `cli: { command }`, `mcp: { expose, name }`.
- Service-level `fields: { rest_token: ['apikey'] }` redacts fields per mode.
- JSON Schema comes from Standard JSON Schema (`~standard.jsonSchema`, zod ≥4.2,
  arktype, valibot) automatically; `registerJsonSchemaConverter` is a fallback.

Naming is derived, once, in `names.ts`: op `setOffset` → CLI `set-offset`,
MCP tool `songs_set_offset`, REST `POST /songs/{slug}/set-offset`.

## Objects

`collection()` and `singleton()` compile to ops with fixed conventions (see the
README table). They record `resource: { kind, fields, summary }` on the
service so other layers can use it: `@onedef/query` writes an action's
returned object straight into the `get` cache when the action's `output` is
the `fields` schema. `action({ needs: 'object' })` makes the backend load the
object through `get` before the handler runs. `restrict` (field → modes) hides
fields per credential mode.

## Implementation (server only)

```ts
export const backend = implement(contract, {
  context: async ({ request }) => ({ userId: await verify(request) }),   // optional
  songs: {
    list: async () => storage.list(),
    get: async ({ id }) => storage.get(id) ?? fail('NOT_FOUND', 'No such lesson'),
    create: async ({ input, ctx }) => ...,
    setOffset: async ({ id, input }) => ...,
  },
})
```

Handler args: `{ input, id, ctx, scope, client, request }` — `client` is a
typed client bound to the same request (call another op without HTTP).
Input is validated against the op schema before the handler runs. Throw
`fail(code, message)` (an `ApiError`) for typed errors.

## Transport — the "requester"

```ts
type Transport = (call: Call, api: Api) => Promise<unknown>
interface Call { service; op; input; scope?; signal?; request?: Request; auth?: Credentials }
```

| transport | package | what it does |
| --- | --- | --- |
| `local(backend)` | `onedef` | in process, no HTTP (server components, MCP with handlers, tests) |
| `http({ baseUrl })` | `onedef` | executes the ops' `http` descriptors (mode 2) |
| `rpc({ url })` | `@onedef/orpc/client` | calls a `toFetchHandler` backend over oRPC (mode 1) |
| `mcpApp()` | `@onedef/mcp/app` | inside an MCP App iframe: each call is a tool call to the host. Returns `undefined` outside an MCP App |

So one UI runs on the web and as an MCP App:

```ts
export const client = createClient(contract, mcpApp() ?? rpc({ url: '/api' }))
```

`mcpApp()` is synchronous: the MCP server injects a marker into the HTML it
serves as the app resource, so there is no handshake to wait for.

## MCP App

```ts
createMcpHandler(backend, {
  app: {
    html: () => readFile('dist/mcp-app.html', 'utf8'),  // any framework, one self-contained file
    tools: ['songs.list', 'songs.get'],                  // tools that open the UI
    csp: { resourceDomains: ['https://i.ytimg.com'], frameDomains: ['https://www.youtube.com'] },
  },
})
```

In the UI, `launch()` (from `@onedef/mcp/app`) resolves to the tool call that
opened it — `{ service: 'songs', op: 'get', input: { slug } }` — so the UI can
route to the right screen.

## Auth

`defineConfig({ auth: { apiKey: {...}, oauth: {...} } })` declares what the
backend accepts. The CLI derives `login` / `logout` / `whoami` from it (API
key prompt and/or OAuth with PKCE + loopback, built on the MCP SDK's client
auth — the same flow an MCP client uses against the same authorization
server). MCP over HTTP is protected by an `authorize(request)` hook that
returns 401 + `WWW-Authenticate: Bearer resource_metadata=...` when it fails.
