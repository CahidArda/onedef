import { Arrow, Box, Bus, Code, cx, Eyebrow, Figure, Note, VWire } from './parts';

// One pulse: down from the client, split to both frames, through each frame to its
// endpoint, then join and reach the backend.
const cycle = 5.8;

const notes = [
  { title: 'Write the launch post', done: true },
  { title: 'Fix the login redirect', done: false },
  { title: 'Plan the next release', done: false },
];

/** The one UI both frames show: a tiny notes screen. */
function NotesScreen() {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold">Notes</p>
        <span className="rounded-md bg-fd-primary px-2 py-0.5 text-[10px] font-medium text-fd-primary-foreground">
          New note
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {notes.map((note) => (
          <li key={note.title} className="flex items-center gap-2 rounded-md bg-fd-secondary/70 px-2 py-1.5 text-[11.5px]">
            <span
              className={cx(
                'flex size-3 shrink-0 items-center justify-center rounded-full border',
                note.done ? 'border-fd-success bg-fd-success' : 'border-fd-muted-foreground/50',
              )}
            >
              {note.done && (
                <svg viewBox="0 0 8 8" className="size-2 text-fd-background" aria-hidden>
                  <path d="M1.5 4.2 3.2 5.8 6.5 2.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              )}
            </span>
            <span className={cx('truncate', note.done && 'text-fd-muted-foreground line-through')}>{note.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BrowserFrame() {
  return (
    <div className="h-full overflow-hidden rounded-xl border border-fd-border bg-fd-background shadow-sm">
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-secondary/60 px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
          <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
          <span className="size-2 rounded-full bg-fd-muted-foreground/30" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-fd-background px-2 py-0.5 text-center font-mono text-[10.5px] text-fd-muted-foreground">
          notes.example.com
        </span>
      </div>
      <NotesScreen />
    </div>
  );
}

function ChatFrame() {
  return (
    <div className="h-full overflow-hidden rounded-xl border border-fd-border bg-fd-background shadow-sm">
      <div className="flex items-center gap-2 border-b border-fd-border bg-fd-secondary/60 px-3 py-2">
        <span className="size-2 rounded-full bg-fd-idea" aria-hidden />
        <span className="text-[11px] font-medium text-fd-muted-foreground">Chat with an AI assistant</span>
      </div>
      <div className="space-y-2 p-3">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-fd-secondary px-3 py-1.5 text-[11.5px]">
          What&apos;s left on my list?
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-fd-muted-foreground">
          <span className="rounded border border-fd-idea/30 bg-fd-idea/10 px-1 font-mono text-[10px] text-fd-idea">
            notes_list
          </span>
          opened your app:
        </p>
        <div className="overflow-hidden rounded-lg border border-fd-idea/40">
          <p className="border-b border-fd-idea/20 bg-fd-idea/10 px-3 py-1 text-[9.5px] font-semibold tracking-wider text-fd-idea uppercase">
            MCP App
          </p>
          <NotesScreen />
        </div>
      </div>
    </div>
  );
}

/** The same UI, shipped once: in a browser it calls /api, inside Claude it calls /mcp. */
export function OneUi({ bare, className }: { bare?: boolean; className?: string }) {
  return (
    <Figure
      bare={bare}
      className={className}
      label="The same notes UI shown twice. In a browser tab, its client uses rpc({ url: '/api' }) and fetches /api. Inside a chat with Claude or ChatGPT, it runs as an MCP App: mcpApp() turns each call into an MCP tool call through the host, to /mcp. Both reach the same backend."
    >
      <div className="flex flex-col items-center">
        <Box className="max-w-full text-center">
          <Eyebrow>one UI, one client</Eyebrow>
          <p className="mt-1.5 font-mono text-[12px] leading-relaxed break-words @lg:text-[13px]">
            createClient(contract, <span className="rounded bg-fd-idea/10 px-1 text-fd-idea">mcpApp()</span>
            {' ?? '}
            <span className="rounded bg-fd-info/10 px-1 text-fd-info">rpc({"{ url: '/api' }"})</span>)
          </p>
        </Box>
        <VWire height="h-5" cycle={cycle} at={[0, 0.3]} />
      </div>

      <div className="relative grid gap-x-6 @lg:grid-cols-2">
        <Bus left="info" right="idea" cycle={cycle} at={[0.3, 1]} className="top-0 right-[calc((100%-1.5rem)/4)] left-[calc((100%-1.5rem)/4)] hidden @lg:flex" />
        {/* the web */}
        <div className="flex min-w-0 flex-col">
          <VWire tone="info" height="h-6" cycle={cycle} at={[1, 1.25]} />
          <Eyebrow className="mb-2 text-center">in a browser</Eyebrow>
          <div className="flex-1">
            <BrowserFrame />
          </div>
          <VWire tone="info" height="h-8" cycle={cycle} at={[2, 2.3]} className="mt-1" />
          <div className="flex flex-col items-center gap-1 text-center">
            <Code tone="info">rpc()</Code>
            <Note>fetch over HTTP</Note>
          </div>
          <VWire tone="info" height="h-6" cycle={cycle} at={[2.55, 2.8]} />
          <Arrow tone="info" />
          <Box tone="info" className="mt-1 text-center">
            <p className="font-mono text-[12px]">/api</p>
            <Note>REST + RPC</Note>
          </Box>
        </div>

        {/* inside the chat */}
        <div className="mt-8 flex min-w-0 flex-col @lg:mt-0">
          <VWire tone="idea" height="h-6" cycle={cycle} at={[1, 1.25]} />
          <Eyebrow className="mb-2 text-center">inside Claude or ChatGPT</Eyebrow>
          <div className="flex-1">
            <ChatFrame />
          </div>
          <VWire tone="idea" height="h-8" cycle={cycle} at={[2, 2.3]} className="mt-1" />
          <div className="flex flex-col items-center gap-1 text-center">
            <Code tone="idea">mcpApp()</Code>
            <Note>tool calls through the MCP host</Note>
          </div>
          <VWire tone="idea" height="h-6" cycle={cycle} at={[2.55, 2.8]} />
          <Arrow tone="idea" />
          <Box tone="idea" className="mt-1 text-center">
            <p className="font-mono text-[12px]">/mcp</p>
            <Note>MCP tools</Note>
          </Box>
        </div>
      </div>

      <div className="relative grid gap-x-6 @lg:grid-cols-2">
        <VWire tone="info" height="h-6" cycle={cycle} at={[3.15, 3.4]} className="hidden @lg:block" />
        <VWire tone="idea" height="h-6" cycle={cycle} at={[3.15, 3.4]} className="hidden @lg:block" />
        <VWire tone="idea" height="h-6" cycle={cycle} at={[3.15, 3.5]} className="@lg:hidden" />
        <Bus left="info" right="idea" mode="merge" cycle={cycle} at={[3.4, 4.1]} className="bottom-0 right-[calc((100%-1.5rem)/4)] left-[calc((100%-1.5rem)/4)] hidden @lg:flex" />
      </div>
      <div className="flex flex-col items-center">
        <VWire height="h-4" cycle={cycle} at={[4.1, 4.3]} className="hidden @lg:block" />
        <Arrow />
        <Box className="mt-1 w-full max-w-sm text-center">
          <p className="font-medium">The same backend</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-fd-muted-foreground">implement(contract, handlers)</p>
        </Box>
      </div>
    </Figure>
  );
}
