import { ogImage, ogSize } from '@/lib/og';

export const alt = 'onedef: define your API once. Serve people and agents.';
export const size = ogSize;
export const contentType = 'image/png';

export default function Image() {
  return ogImage({
    title: 'Define your API once. Serve people and agents.',
    description:
      'REST with OpenAPI, a typed client, an MCP server, an MCP App and a CLI, from one TypeScript contract.',
  });
}
