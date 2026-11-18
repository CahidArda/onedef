import Link from 'next/link';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';

const contract = `export const notes = collection(config, {
  name: 'notes',
  description: 'Your notes.',
  id: 'id',
  fields: Note,
  create: { input: z.object({ title: z.string() }) },
  actions: {
    complete: action({
      summary: 'Mark a note as done',
      output: Note,
      needs: 'object',
    }),
  },
})`;

const backend = `export const backend = implement(contract, {
  notes: {
    list: () => db.notes.list(),
    get: ({ id }) => db.notes.get(id) ?? fail('NOT_FOUND'),
    create: ({ input }) => db.notes.create(input),
    complete: ({ object }) =>
      db.notes.save({ ...object, done: true }),
  },
})`;

const surfaces: { name: string; detail: string; code: string }[] = [
  { name: 'REST + OpenAPI', detail: 'GET /api/notes, POST /api/notes/{id}/complete, /api/openapi.json', code: 'toNextHandlers(backend)' },
  { name: 'MCP server', detail: 'notes_list, notes_create, notes_complete for Claude, ChatGPT, Cursor', code: 'createMcpHandler(backend)' },
  { name: 'Typed client', detail: 'api.notes.complete({ id }) in your web app and SDK', code: "createClient(contract, rpc({ url: '/api' }))" },
  { name: 'MCP App', detail: 'Your React screens, rendered inside Claude and ChatGPT', code: 'defineMcpApp(contract, { routes })' },
  { name: 'CLI with login', detail: 'acme notes complete <id>, acme login with OAuth or an API key', code: 'runCli(contract, { transport })' },
  { name: 'TanStack Query', detail: 'Query keys and cache invalidation from the contract', code: 'createQueryUtils(contract, client)' },
];

const reasons: { title: string; body: string }[] = [
  {
    title: 'One source of truth',
    body: 'Add a field or an endpoint once. The REST route, the MCP tool, the CLI command, the client type and the OpenAPI document all follow.',
  },
  {
    title: 'Type-safe end to end',
    body: 'A missing handler, a misspelled operation or a wrong return shape is a compile error, not a bug report.',
  },
  {
    title: 'Built for agents',
    body: 'MCP tools carry your descriptions. Your real UI renders inside Claude. Long tasks pause to ask the user or the agent, and continue.',
  },
  {
    title: 'Fits what you have',
    body: 'Plain fetch handlers for Next.js, Hono, Bun and workers. Your database stays yours. Already have an API? Describe it, and get an MCP server and a CLI.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      {/* Hero: what it is, in one sentence */}
      <section className="pt-16 pb-12 text-center sm:pt-24">
        <p className="mb-4 text-sm font-medium text-fd-muted-foreground">TypeScript · Next.js · MCP</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Define your API once.
          <br />
          Serve people and agents.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-fd-muted-foreground">
          Write one contract and its handlers. onedef gives you REST with OpenAPI, a typed client, an MCP
          server, an MCP App, a CLI with login and TanStack Query helpers, all from that one definition,
          and all kept in sync.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/docs/quickstart"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Quick start: 5 minutes
          </Link>
          <Link
            href="/docs"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            What is onedef?
          </Link>
        </div>
      </section>

      {/* The idea, shown: one contract in, every surface out */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
            1 · Describe it
          </h2>
          <ServerCodeBlock code={contract} lang="ts" codeblock={{ title: 'contract.ts' }} />
          <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
            2 · Implement it
          </h2>
          <ServerCodeBlock code={backend} lang="ts" codeblock={{ title: 'backend.ts' }} />
        </div>
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fd-muted-foreground">
            3 · Get every surface
          </h2>
          <ul className="grid gap-3">
            {surfaces.map((surface) => (
              <li key={surface.name} className="rounded-xl border border-fd-border bg-fd-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{surface.name}</span>
                  <code className="text-xs text-fd-muted-foreground">{surface.code}</code>
                </div>
                <p className="mt-1 text-sm text-fd-muted-foreground">{surface.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Why */}
      <section className="mt-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Your API has more users than your web app
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-fd-muted-foreground">
          The same product needs a web app, an API, an SDK, a CLI and an MCP server. Written by hand, they
          drift apart. With onedef they are one thing.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {reasons.map((reason) => (
            <div key={reason.title} className="rounded-xl border border-fd-border bg-fd-card p-6">
              <h3 className="font-semibold">{reason.title}</h3>
              <p className="mt-2 text-sm text-fd-muted-foreground">{reason.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The standalone package */}
      <section className="mt-20 rounded-2xl border border-fd-border bg-fd-card p-6 sm:p-10">
        <p className="text-sm font-medium text-fd-muted-foreground">Works without onedef</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          MCP tools that ask, then continue
        </h2>
        <p className="mt-3 max-w-3xl text-fd-muted-foreground">
          With MCP elicitation, the client calls your tool again after the user answers, so everything before
          the question runs twice. <code>@onedef/mcp-elicitation-workflow</code> turns the tool into a durable
          workflow: it asks the user for approval or a form, or asks the agent to do a step, and continues
          exactly where it stopped. Add it to any MCP SDK server.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-fd-border p-4 font-mono text-xs leading-6">
            <p className="mb-2 font-sans text-sm font-medium">Plain MCP elicitation</p>
            <p className="whitespace-pre">BUILD build-1</p>
            <p className="whitespace-pre text-fd-muted-foreground">USER  approve build-1</p>
            <p className="whitespace-pre">BUILD build-2   ← runs again</p>
            <p className="whitespace-pre">SHIP  build-2   ← not the one approved</p>
          </div>
          <div className="rounded-xl border border-fd-border p-4 font-mono text-xs leading-6">
            <p className="mb-2 font-sans text-sm font-medium">Elicitation workflow</p>
            <p className="whitespace-pre">BUILD build-1</p>
            <p className="whitespace-pre text-fd-muted-foreground">USER  approve build-1</p>
            <p className="whitespace-pre">SHIP  build-1   ← the one approved</p>
          </div>
        </div>
        <Link
          href="/docs/mcp-elicitation-workflow"
          className="mt-6 inline-block rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          Read about elicitation workflows
        </Link>
      </section>
    </main>
  );
}
