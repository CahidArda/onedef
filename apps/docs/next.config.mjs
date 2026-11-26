import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Pages moved when the docs were regrouped into define / serve / clients.
  async redirects() {
    return [
      ['/docs/concepts/contract', '/docs/define/contract'],
      ['/docs/concepts/backend', '/docs/define/backend'],
      ['/docs/guides/existing-api', '/docs/define/existing-api'],
      ['/docs/surfaces/rest', '/docs/serve/rest'],
      ['/docs/surfaces/mcp', '/docs/serve/mcp'],
      ['/docs/surfaces/api-docs', '/docs/serve/api-docs'],
      ['/docs/concepts/clients', '/docs/clients'],
      ['/docs/surfaces/mcp-apps', '/docs/clients/one-ui'],
      ['/docs/surfaces/react-query', '/docs/clients/tanstack-query'],
      ['/docs/surfaces/cli', '/docs/clients/cli'],
    ].map(([source, destination]) => ({ source, destination, permanent: true }));
  },
  async rewrites() {
    return [
      {
        source: '/docs/:path*.md',
        destination: '/llms.mdx/docs/:path*.md',
      },
      {
        source: '/docs/:path*.txt',
        destination: '/llms.mdx/docs/:path*.txt',
      },
    ];
  },
};

export default withMDX(config);
