import Link from 'next/link';
import type { ReactNode } from 'react';
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import { ElicitationReplay, OneContract, OneUi, Transports } from '@/components/diagrams';
import { gitConfig, siteName, siteUrl } from '@/lib/shared';

const contract = `export const notes = collection(config, {
  name: 'notes',
  description: 'Your notes.',
  id: 'id',
  fields: Note,
  create: { input: z.object({ title: z.string() }) },
  actions: {
    complete: action({ output: Note, needs: 'object' }),
  },
})`;

const backend = `export const backend = implement(contract, {
  notes: {
    list: () => db.notes.list(),
    get: ({ id }) => db.notes.get(id),
    create: ({ input }) => db.notes.create(input),
    complete: ({ object }) =>
      db.notes.save({ ...object, done: true }),
  },
})`;

// Tells Google the site's name, so results show "OneDef" rather than the parent domain.
const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: siteName,
  alternateName: ['onedef'],
  url: siteUrl.href,
};

function Section({
  eyebrow,
  title,
  children,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-24 sm:mt-32">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium text-fd-muted-foreground">{eyebrow}</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
        <p className="mt-4 text-fd-muted-foreground text-pretty">{lead}</p>
      </div>
      <div className="mt-10">{children}</div>
    </section>
  );
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
    >
      {children}
    </Link>
  );
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
    >
      {children}
    </Link>
  );
}

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl overflow-x-clip px-4 pb-24 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />

      {/* Hero */}
      <section className="pt-16 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Define your API once.
          <br />
          Serve people and agents.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-fd-muted-foreground text-pretty">
          One contract becomes REST with OpenAPI, an MCP server, a CLI and a typed client. One UI runs on
          the web and inside Claude, as an MCP App.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PrimaryLink href="/docs/quickstart">Quick start: 5 minutes</PrimaryLink>
          <SecondaryLink href="/docs">What is onedef?</SecondaryLink>
        </div>
      </section>

      {/* One contract */}
      <Section
        eyebrow="One contract"
        title="Describe it, implement it. Every surface follows."
        lead="The contract is schemas and summaries, with no server code. The server exposes it; every caller is typed from it. Add a field once, and REST, MCP, the CLI and the client all have it."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 [&>figure]:h-full">
            <ServerCodeBlock code={contract} lang="ts" codeblock={{ title: 'contract.ts' }} />
          </div>
          <div className="min-w-0 [&>figure]:h-full">
            <ServerCodeBlock code={backend} lang="ts" codeblock={{ title: 'backend.ts' }} />
          </div>
        </div>
        <OneContract className="mt-4" />
      </Section>

      {/* One client, any transport */}
      <Section
        eyebrow="One client"
        title="The same typed call, wherever the answer is."
        lead={
          <>
            <code className="text-fd-foreground">createClient(contract, transport)</code> gives you{' '}
            <code className="text-fd-foreground">api.notes.complete(&#123; id &#125;)</code>. The transport
            decides who answers: your handlers in process, your backend over HTTP, or MCP tools through the host.
          </>
        }
      >
        <div className="mx-auto max-w-3xl">
          <Transports />
        </div>
      </Section>

      {/* One UI, two homes: the client from above, with the transport picked at runtime */}
      <Section
        eyebrow="One UI"
        title="Ship your UI once. It runs in the browser and inside Claude (as an MCP App)."
        lead="Deployed, your screens fetch your API. Opened by a tool in Claude or ChatGPT, the same screens call the same API as MCP tools. One line picks the transport."
      >
        <div className="mx-auto max-w-3xl">
          <OneUi />
        </div>
      </Section>

      {/* The standalone package */}
      <Section
        eyebrow="Works without onedef"
        title="MCP tools that ask, then continue."
        lead={
          <>
            With plain MCP elicitation, the tool runs again after the user answers.{' '}
            <code className="text-fd-foreground">@onedef/mcp-elicitation-workflow</code> records each step,
            so the tool continues exactly where it asked. Add it to any MCP SDK server.
          </>
        }
      >
        <div className="mx-auto max-w-3xl">
          <ElicitationReplay />
          <div className="mt-2 text-center">
            <SecondaryLink href="/docs/mcp-elicitation-workflow">Read about elicitation workflows</SecondaryLink>
          </div>
        </div>
      </Section>

      {/* Close */}
      <section className="mt-24 text-center sm:mt-32">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">One definition. Every user.</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <PrimaryLink href="/docs/quickstart">Start building</PrimaryLink>
          <SecondaryLink href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}>GitHub</SecondaryLink>
        </div>
      </section>
    </main>
  );
}
