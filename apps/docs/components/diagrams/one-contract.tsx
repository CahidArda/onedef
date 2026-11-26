import { Arrow, Box, Bus, Code, Eyebrow, Figure, HWire, Note, VWire, type Tone } from './parts';

// One pulse: from the contract out to both sides, then a call crossing from the client,
// through each transport, to the server.
const cycle = 4.6;

const callers: { name: string; code?: string }[] = [
  { name: 'Your web UI' },
  { name: 'The same UI as an MCP App' },
  { name: 'TanStack Query', code: 'createQueryUtils' },
  { name: 'CLI with login', code: 'runCli' },
  { name: 'Your SDK' },
];

const exposed: { name: string; code: string }[] = [
  { name: 'REST + RPC + OpenAPI', code: 'toNextHandlers' },
  { name: 'MCP server', code: 'createMcpHandler' },
  { name: 'MCP App resource', code: 'serveMcpApp' },
  { name: 'API docs', code: 'toMintlify' },
];

const transports: { code: string; tone: Tone }[] = [
  { code: 'local()', tone: 'success' },
  { code: 'rpc()', tone: 'info' },
  { code: 'mcpApp()', tone: 'idea' },
  { code: 'http()', tone: 'muted' },
];

function Row({ name, code }: { name: string; code?: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-lg bg-fd-secondary/60 px-2.5 py-1.5">
      <span className="text-[12.5px]">{name}</span>
      {code && <span className="font-mono text-[10.5px] text-fd-muted-foreground">{code}</span>}
    </li>
  );
}

/** One contract; the server side implements it, the client side calls it, transports connect them. */
export function OneContract({ bare, className }: { bare?: boolean; className?: string }) {
  return (
    <Figure
      bare={bare}
      className={className}
      label="contract.ts holds schemas and summaries and no server code. On the calling side, createClient(contract, transport) is the typed client your web UI, the MCP App UI, TanStack Query, the CLI and an SDK are built on. On the server side, implement(contract, handlers) is exposed as REST, RPC and OpenAPI, an MCP server, the MCP App resource and API docs. A transport connects the two: local(), rpc(), mcpApp() or http()."
    >
      <div className="flex flex-col items-center">
        <Box className="w-full max-w-xs text-center">
          <p className="font-mono text-[13px] font-medium">contract.ts</p>
          <Note className="mt-0.5">schemas + summaries, no server code</Note>
        </Box>
        <VWire height="h-5" cycle={cycle} at={[0, 0.3]} />
      </div>

      <div className="relative grid gap-y-0 @xl:grid-cols-[1fr_10rem_1fr] @xl:gap-x-0">
        <Bus left="muted" right="muted" cycle={cycle} at={[0.3, 1]} className="top-0 right-[calc((100%-10rem)/4)] left-[calc((100%-10rem)/4)] hidden @xl:flex" />

        {/* calls it */}
        <div className="flex min-w-0 flex-col">
          <VWire height="h-5" cycle={cycle} at={[1, 1.2]} className="hidden @xl:block" />
          <Box className="flex-1">
            <Eyebrow>calls it</Eyebrow>
            <div className="mt-1.5">
              <Code>createClient(contract, transport)</Code>
            </div>
            <Note className="mt-2 mb-1.5">a typed client, and what's built on it:</Note>
            <ul className="space-y-1">
              {callers.map((c) => (
                <Row key={c.name} {...c} />
              ))}
            </ul>
          </Box>
        </div>

        {/* transports */}
        <div className="flex flex-col items-center justify-center py-2 @xl:pt-10">
          <VWire tone="info" height="h-5" cycle={cycle} at={[1.6, 1.9]} className="@xl:hidden" />
          <Eyebrow className="my-1.5">transport</Eyebrow>
          <ul className="flex flex-wrap justify-center gap-1.5 @xl:flex-col @xl:gap-2">
            {transports.map((t, i) => (
              <li key={t.code} className="flex items-center @xl:w-full">
                <HWire tone={t.tone} cycle={cycle} at={[1.6 + i * 0.12, 2.2 + i * 0.12]} className="hidden @xl:block" />
                <Code tone={t.tone}>{t.code}</Code>
                <HWire tone={t.tone} cycle={cycle} at={[2.4 + i * 0.12, 3 + i * 0.12]} className="hidden @xl:block" />
              </li>
            ))}
          </ul>
          <VWire tone="info" height="h-5" cycle={cycle} at={[2.2, 2.5]} className="mt-1.5 @xl:hidden" />
          <Arrow tone="info" className="@xl:hidden" />
        </div>

        {/* exposes it */}
        <div className="flex min-w-0 flex-col">
          <VWire height="h-5" cycle={cycle} at={[1, 1.2]} className="hidden @xl:block" />
          <Box className="flex-1">
            <Eyebrow>serves it</Eyebrow>
            <div className="mt-1.5">
              <Code>implement(contract, handlers)</Code>
            </div>
            <Note className="mt-2 mb-1.5">on the server, exposed as:</Note>
            <ul className="space-y-1">
              {exposed.map((e) => (
                <Row key={e.name} {...e} />
              ))}
            </ul>
          </Box>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-fd-muted-foreground">
        Both sides are typed from the contract: a missing handler or a wrong shape is a compile error.
      </p>
    </Figure>
  );
}
