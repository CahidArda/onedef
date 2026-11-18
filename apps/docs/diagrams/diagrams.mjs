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

export const diagrams = {
  // mcp-elicitation-workflow/index: plain elicitation builds twice; the workflow once.
  'elicitation-replay': [
    text(110, 0, 'call 1', 22, { strokeColor: '#868e96' }),
    text(590, 0, 'call 2', 22, { strokeColor: '#868e96' }),
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
    box(0, 40, 180, 80, 'Agent', blue),
    box(520, 40, 220, 80, 'Your MCP server', violet),
    arrow(186, 60, 514, 60, { label: { text: 'the answer', fontSize: 18 } }),
    arrow(514, 100, 186, 100, { label: { text: 'the next question', fontSize: 18 } }),
    text(280, 130, 'until the run is done', 16, { strokeColor: '#868e96' }),
  ],

  // index: one contract, every surface.
  'one-contract': [
    box(190, 0, 260, 70, 'contract + handlers', blue),
    ...['REST + OpenAPI\ntyped client', 'MCP server\nMCP App', 'CLI\nTanStack Query'].flatMap((label, i) => {
      const x = i * 230;
      return [box(x, 170, 200, 80, label, 'transparent'), arrow(320, 76, x + 100, 164)];
    }),
  ],
};
