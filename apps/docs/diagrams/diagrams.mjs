// The docs' hand-drawn diagrams, as Excalidraw element skeletons.
//
// `render.mjs` turns each into public/diagrams/<name>.svg and <name>-dark.svg
// with Excalidraw's own exporter, and writes <name>.excalidraw next to this
// file so a diagram can also be opened and edited on excalidraw.com. Edit the
// skeletons here and re-render; don't hand-edit the SVGs.

const blue = '#a5d8ff';
const green = '#b2f2bb';
const red = '#ffc9c9';
const violet = '#d0bfff';
const grey = '#e9ecef';

function box(x, y, width, height, text, backgroundColor = grey, extra = {}) {
  return {
    type: 'rectangle',
    x,
    y,
    width,
    height,
    backgroundColor,
    fillStyle: 'solid',
    roundness: { type: 3 },
    label: { text, fontSize: 20 },
    ...extra,
  };
}

function arrow(x1, y1, x2, y2, extra = {}) {
  return {
    type: 'arrow',
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    points: [
      [0, 0],
      [x2 - x1, y2 - y1],
    ],
    ...extra,
  };
}

function text(x, y, value, fontSize = 20, extra = {}) {
  return { type: 'text', x, y, text: value, fontSize, ...extra };
}

// Text centred in a box with no outline: box labels are centred, free text is placed by
// its left edge, and guessing a hand-drawn font's width puts it off-centre.
function caption(x, y, width, value, fontSize = 16, color) {
  return box(x, y, width, fontSize + 14, '', 'transparent', {
    strokeColor: 'transparent',
    label: { text: value, fontSize, ...(color ? { strokeColor: color } : {}) },
  });
}

export const diagrams = {
  // mcp-elicitation-workflow/index: plain elicitation builds twice; the workflow once.
  'elicitation-replay': [
    // two columns, 280 wide, at x=0 and x=480
    caption(0, 0, 280, 'call 1', 22, '#868e96'),
    caption(480, 0, 280, 'call 2', 22, '#868e96'),
    text(0, 50, 'Plain MCP elicitation', 24),
    box(0, 95, 280, 80, 'build build-1\nask the user', grey),
    arrow(290, 135, 470, 135, { label: { text: 'user approves', fontSize: 16 } }),
    box(480, 95, 280, 80, 'build build-2\nship build-2 ✗', red),
    text(0, 225, 'Elicitation workflow', 24),
    box(0, 270, 280, 80, 'build build-1 (recorded)\nask the user', grey),
    arrow(290, 310, 470, 310, { label: { text: 'user approves', fontSize: 16 } }),
    box(480, 270, 280, 80, 'build-1 from the log\nship build-1 ✓', green),
  ],

  // mcp-elicitation-workflow/asking-the-agent: the start / next loop.
  'agent-loop': [
    // two equal boxes, 220 wide, at x=0 and x=520; the gap between them is 300
    box(0, 40, 220, 80, 'Agent', blue),
    box(520, 40, 220, 80, 'Your MCP server', violet),
    arrow(226, 60, 514, 60, { label: { text: 'the answer', fontSize: 18 } }),
    arrow(514, 100, 226, 100, { label: { text: 'the next question', fontSize: 18 } }),
    caption(220, 130, 300, 'until the run is done', 16, '#868e96'),
  ],

  // index, "How it fits together": the contract, the server side, the clients, and the
  // transport that connects a client to whoever answers.
  'fits-together': [
    // a symmetric grid: contract centred at x=480, backend centred at 160, clients at 800
    box(330, 0, 300, 80, 'contract.ts', blue, {
      label: { text: 'contract.ts\nschemas + summaries, no server code', fontSize: 16 },
    }),
    arrow(430, 86, 160, 164),
    arrow(530, 86, 800, 164),
    box(0, 170, 320, 100, 'backend', violet, {
      label: { text: 'backend.ts\nimplement(contract, handlers)', fontSize: 16 },
    }),
    box(640, 170, 320, 100, 'clients', green, {
      label: {
        text: 'createClient(contract, transport)\nrunCli(contract, …)\ncreateQueryUtils(contract, client)',
        fontSize: 16,
      },
    }),
    arrow(634, 220, 326, 220, {
      strokeStyle: 'dashed',
      label: { text: 'transport', fontSize: 16 },
    }),
    caption(330, 236, 300, 'rpc() · local() · mcpApp() · http()', 14, '#868e96'),
    arrow(110, 276, 10, 364),
    arrow(210, 276, 310, 364),
    box(-130, 370, 280, 80, 'rest', 'transparent', {
      label: { text: 'toNextHandlers(backend)\nREST + RPC + OpenAPI', fontSize: 16 },
    }),
    box(170, 370, 280, 80, 'mcp', 'transparent', {
      label: { text: 'createMcpHandler(backend)\nMCP tools + MCP App', fontSize: 16 },
    }),
  ],

  // index: one contract, every surface.
  'one-contract': [
    // three 200-wide boxes 230 apart (centres 100, 330, 560); the contract is centred on 330
    box(200, 0, 260, 70, 'contract + handlers', blue),
    ...['REST + OpenAPI\ntyped client', 'MCP server\nMCP App', 'CLI\nTanStack Query'].flatMap((label, i) => {
      const x = i * 230;
      return [box(x, 170, 200, 80, label, 'transparent'), arrow(330, 76, x + 100, 164)];
    }),
  ],
};
