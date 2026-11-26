import type { ReactNode } from 'react';
import { Arrow, Box, Code, cx, Eyebrow, Figure, HWire, Note, VWire, type Tone } from './parts';

type Line = { verb: string; text: ReactNode; tone?: Tone; note?: string };

function Call({ title, lines, tone }: { title: string; lines: Line[]; tone?: Tone }) {
  return (
    <Box tone={tone} className="w-full @lg:w-auto @lg:flex-1">
      <Eyebrow>{title}</Eyebrow>
      <ul className="mt-1.5 space-y-1 font-mono text-[12px]">
        {lines.map((line) => (
          <li key={line.verb + String(line.note)} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-10 shrink-0 text-[10.5px] text-fd-muted-foreground">{line.verb}</span>
            <span
              className={cx(
                line.tone === 'error' && 'text-fd-error',
                line.tone === 'success' && 'text-fd-success',
              )}
            >
              {line.text}
            </span>
            {line.note && <span className="font-sans text-[11px] text-fd-muted-foreground">{line.note}</span>}
          </li>
        ))}
      </ul>
    </Box>
  );
}

function Approve({ tone }: { tone: Tone }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center @lg:w-28 @lg:px-2">
      <span className="my-1 rounded-full bg-fd-secondary px-2 py-0.5 text-[11px] text-fd-muted-foreground @lg:mt-0 @lg:mb-1.5 @lg:bg-transparent @lg:px-0">
        user approves
      </span>
      <VWire tone={tone} height="h-4" at={[1, 1.6]} className="@lg:hidden" />
      <Arrow tone={tone} className="@lg:hidden" />
      <div className="hidden w-full items-center @lg:flex">
        <HWire tone={tone} at={[1, 1.8]} />
        <Arrow dir="right" tone={tone} className="mx-0" />
      </div>
    </div>
  );
}

function Row({ title, tone, call1, call2, verdict }: { title: string; tone: Tone; call1: Line[]; call2: Line[]; verdict: string }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{title}</p>
        <p className={cx('text-xs', tone === 'error' ? 'text-fd-error' : 'text-fd-success')}>{verdict}</p>
      </div>
      <div className="flex flex-col items-stretch @lg:flex-row">
        <Call title="call 1" lines={call1} />
        <Approve tone={tone} />
        <Call title="call 2" lines={call2} tone={tone} />
      </div>
    </div>
  );
}

/** Plain MCP elicitation re-runs the tool; the workflow replays recorded steps and continues. */
export function ElicitationReplay({ bare, className }: { bare?: boolean; className?: string }) {
  return (
    <Figure
      bare={bare}
      className={className}
      label="Plain MCP elicitation: call 1 builds build-1 and asks the user; after the user approves, call 2 runs the tool again, builds build-2 and ships it, not the build that was approved. Elicitation workflow: call 1 builds build-1, records it and asks; call 2 takes build-1 from the log and ships it."
    >
      <div className="space-y-6">
        <Row
          title="Plain MCP elicitation"
          tone="error"
          verdict="ships a build nobody approved"
          call1={[
            { verb: 'build', text: 'build-1' },
            { verb: 'ask', text: 'deploy build-1?' },
          ]}
          call2={[
            { verb: 'build', text: 'build-2', tone: 'error', note: 'runs again' },
            { verb: 'ship', text: 'build-2 ✗', tone: 'error' },
          ]}
        />
        <Row
          title="Elicitation workflow"
          tone="success"
          verdict="ships the approved build"
          call1={[
            { verb: 'build', text: 'build-1', note: 'recorded' },
            { verb: 'ask', text: 'deploy build-1?' },
          ]}
          call2={[
            { verb: 'build', text: 'build-1', tone: 'success', note: 'from the log' },
            { verb: 'ship', text: 'build-1 ✓', tone: 'success' },
          ]}
        />
      </div>
    </Figure>
  );
}

/** The start / next loop between the agent and a workflow tool. */
export function AgentLoop({ bare, className }: { bare?: boolean; className?: string }) {
  return (
    <Figure
      bare={bare}
      className={className}
      label="The agent calls write_guide({ topic }). Your MCP server answers with the run id and the next question. The agent does the work and sends the answer with write_guide_next({ runId, payload }), and the loop repeats until the run is done."
    >
      <div className="flex flex-col items-stretch gap-0 @lg:flex-row @lg:items-center">
        <Box tone="info" className="text-center @lg:w-36">
          <p className="font-medium">Agent</p>
          <Note>the user&apos;s own model</Note>
        </Box>

        {/* phone: two wires side by side; wider: two wires stacked */}
        <div className="flex justify-center gap-10 py-1 @lg:hidden">
          <div className="flex flex-col items-center">
            <VWire tone="info" height="h-10" cycle={3} at={[0, 1.1]} />
            <Arrow tone="info" />
            <Note className="mt-1">the answer</Note>
          </div>
          <div className="flex flex-col items-center">
            <Note className="mb-1">the next question</Note>
            <Arrow dir="up" tone="idea" />
            <VWire tone="idea" height="h-10" reverse cycle={3} at={[1.5, 2.6]} />
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 flex-col gap-4 px-3 @lg:flex">
          <div>
            <p className="mb-1 text-center">
              <Code tone="info" className="text-[11px] whitespace-nowrap">write_guide_next({'{ runId, payload }'})</Code>
            </p>
            <div className="flex items-center">
              <HWire tone="info" cycle={3} at={[0, 1.1]} />
              <Arrow dir="right" tone="info" className="mx-0" />
            </div>
          </div>
          <div>
            <div className="flex items-center">
              <Arrow dir="left" tone="idea" className="mx-0" />
              <HWire tone="idea" reverse cycle={3} at={[1.5, 2.6]} />
            </div>
            <p className="mt-1 text-center">
              <Code tone="idea">{'{ runId, waitingFor }'}</Code>
            </p>
          </div>
        </div>

        <Box tone="idea" className="text-center @lg:w-36">
          <p className="font-medium">Your MCP server</p>
          <Note>the workflow run</Note>
        </Box>
      </div>
      <Note className="mt-4 text-center">
        Started by <span className="font-mono">write_guide({'{ topic }'})</span>; repeats until{' '}
        <span className="font-mono">status</span> is <span className="font-mono">done</span>.
      </Note>
    </Figure>
  );
}
