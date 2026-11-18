# onedef docs

The documentation site, built with [Fumadocs](https://fumadocs.dev) on Next.js.

```bash
pnpm --filter @onedef/site dev     # http://localhost:3000
pnpm --filter @onedef/site build
```

- Pages are MDX in `content/docs`; the sidebar order is `content/docs/meta.json`.
- The landing page is `app/(home)/page.tsx`.
- Every page is also served as Markdown (`/docs/<page>.md`), and the whole site as
  `/llms.txt` and `/llms-full.txt`, for agents.
- The quick start's code is `examples/quickstart`, which is built and run; keep the two in sync.

Deploy: import the repository on Vercel with the root directory `apps/docs`.

## Environment

| variable | what |
| --- | --- |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 measurement ID (`G-…`). Set it for **Production** only in the Vercel project; local builds and previews leave it unset and send nothing. |
| `SITE_URL` | The site's address, for absolute Open Graph, sitemap and robots URLs. Default `https://onedef.cahidarda.com`. |
