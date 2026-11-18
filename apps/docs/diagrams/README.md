# Diagrams

The docs' hand-drawn diagrams are Excalidraw drawings, kept as code.

- `diagrams.mjs` describes each diagram as Excalidraw element skeletons.
- `render.mjs` exports each one with Excalidraw's own exporter, to
  `public/diagrams/<name>.svg` and `<name>-dark.svg` (fonts embedded), and writes
  `<name>.excalidraw` here, which opens on excalidraw.com for a look or a sketch.
- Pages show one with `<Diagram name="replay" alt="…" />`, which picks the version for
  the reader's theme.

The SVGs are committed, so building the site doesn't need any of this. To re-render, install
the tools somewhere outside the workspace and point the script at them:

```bash
mkdir -p /tmp/diagram-tools && cd /tmp/diagram-tools
npm init -y && npm i @excalidraw/excalidraw@0.18.0 react@19 react-dom@19 esbuild playwright
cd - && node apps/docs/diagrams/render.mjs /tmp/diagram-tools
```

Edit `diagrams.mjs`, not the SVGs or the `.excalidraw` files: they're overwritten.
