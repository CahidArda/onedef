import { Arrow, Box, Bus, Code, Eyebrow, Figure, Note, VWire, type Tone } from './parts';

// One pulse: down from the client, out along the bus to all three transports, then
// down each to whoever answers.
const cycle = 4.2;

const routes: {
  transport: string;
  tone: Tone;
  wire: string;
  target: string;
  detail: string;
  usedBy: string;
}[] = [
  {
    transport: 'local(backend)',
    tone: 'success',
    wire: 'a function call',
    target: 'Your handlers',
    detail: 'in the same process',
    usedBy: 'server components, tests, scripts',
  },
  {
    transport: "rpc({ url: '/api' })",
    tone: 'info',
    wire: 'HTTP',
    target: 'oRPC backend',
    detail: '/api, REST + RPC',
    usedBy: 'your web app, the CLI, an SDK',
  },
  {
    transport: 'mcpApp()',
    tone: 'idea',
    wire: 'postMessage → MCP host',
    target: 'MCP tools',
    detail: '/mcp, called by Claude or ChatGPT',
    usedBy: 'your UI, inside an MCP App',
  },
];

/** One typed client; the transport decides who answers the call. */
export function Transports({ bare, className }: { bare?: boolean; className?: string }) {
  return (
    <Figure
      bare={bare}
      className={className}
      label="One typed client, createClient(contract, transport). The local(backend) transport calls your handlers in the same process; rpc({ url }) calls the oRPC backend over HTTP; mcpApp() makes MCP tool calls through the host. http({ baseUrl }) calls an existing REST API directly."
    >
      <div className="flex flex-col items-center">
        <Box className="w-full max-w-sm text-center">
          <Eyebrow>one client</Eyebrow>
          <div className="mt-1.5">
            <Code>createClient(contract, transport)</Code>
          </div>
          <p className="mt-2 font-mono text-xs text-fd-muted-foreground">
            await api.notes.complete({'{ id }'})
          </p>
        </Box>
        <VWire height="h-6" cycle={cycle} at={[0, 0.3]} />
      </div>

      <div className="relative grid gap-x-4 gap-y-6 @lg:grid-cols-3">
        {/* the bus the three transports hang from */}
        <Bus left="success" right="idea" cycle={cycle} at={[0.3, 1]} className="top-0 right-[calc((100%-2rem)/6)] left-[calc((100%-2rem)/6)] hidden @lg:flex" />
        {routes.map((route, i) => (
          <div key={route.transport} className="flex min-w-0 flex-col items-center text-center">
            <VWire tone={route.tone} cycle={cycle} at={i === 1 ? [0.3, 1.2] : [1, 1.2]} height="h-5" className="hidden @lg:block" />
            <Code tone={route.tone} className="text-[12px]">
              {route.transport}
            </Code>
            <Note className="mt-1">{route.usedBy}</Note>
            <VWire tone={route.tone} cycle={cycle} at={[1.6, 2]} height="h-9" className="mt-2" />
            <Arrow tone={route.tone} />
            <span className="mt-1 mb-1 rounded-full bg-fd-secondary px-2 py-0.5 text-[11px] text-fd-muted-foreground">
              {route.wire}
            </span>
            <Box tone={route.tone} className="w-full">
              <p className="font-medium">{route.target}</p>
              <Note>{route.detail}</Note>
            </Box>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col items-center gap-2 border-t border-dashed border-fd-border pt-4 text-center @lg:flex-row @lg:justify-center @lg:gap-3">
        <Note>Already run a REST API?</Note>
        <Code>http({'{ baseUrl }'})</Code>
        <Note>calls it directly, with no onedef backend.</Note>
      </div>
    </Figure>
  );
}
