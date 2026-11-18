// A hand-drawn diagram from public/diagrams, in the reader's theme. Each
// diagram is exported twice (see diagrams/render.mjs), and CSS shows the one
// that matches, so there's no flash and no client code.

export function Diagram({ name, alt }: { name: string; alt: string }) {
  return (
    <figure className="not-prose my-6 overflow-x-auto">
      <img src={`/diagrams/${name}.svg`} alt={alt} className="mx-auto max-w-full dark:hidden" />
      <img src={`/diagrams/${name}-dark.svg`} alt={alt} className="mx-auto hidden max-w-full dark:block" />
    </figure>
  );
}
