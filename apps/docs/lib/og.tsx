// Open Graph images for the landing page and every docs page, drawn with
// next/og (satori). One module so the landing page and the docs route share a
// look. The fonts ship with the site (satori needs WOFF/TTF bytes, not a CSS
// URL) and are read once per process.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };

export interface OgContent {
  /** The page title; on the landing page, the headline. */
  title: string;
  description?: string;
  /** Shown after the name: the docs section. Nothing on the landing page. */
  section?: string;
}

const SECTIONS: Record<string, string> = {
  define: 'Define',
  serve: 'Serve',
  clients: 'Clients',
  guides: 'Guides',
  'mcp-elicitation-workflow': 'MCP elicitation workflow',
};

/** The section label for a docs page, from its first slug. */
export function sectionOf(slugs: string[]): string {
  return SECTIONS[slugs[0]!] || 'Docs';
}

type Fonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>['fonts']>;
let fonts: Promise<Fonts> | undefined;

function loadFonts(): Promise<Fonts> {
  const font = (file: string) => readFile(path.join(process.cwd(), 'assets/og', file));
  fonts ??= Promise.all([
    font('inter-latin-400-normal.woff'),
    font('inter-latin-700-normal.woff'),
  ]).then(([regular, bold]) => [
    { name: 'Inter', data: regular, weight: 400, style: 'normal' },
    { name: 'Inter', data: bold, weight: 700, style: 'normal' },
  ]);
  return fonts;
}

/** Shrink long titles so they stay within three lines. */
function titleSize(title: string): number {
  if (title.length > 48) return 56;
  if (title.length > 30) return 66;
  return 78;
}

export async function ogImage({ title, description, section }: OgContent): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#fbfaf7',
          backgroundImage: 'radial-gradient(#d6d3cd 1.5px, transparent 1.5px)',
          backgroundSize: '28px 28px',
          color: '#0f172a',
          fontFamily: 'Inter',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>onedef</div>
          {section && <div style={{ fontSize: 26, color: '#64748b' }}>{`/ ${section}`}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1000 }}>
          <div style={{ fontSize: titleSize(title), fontWeight: 700, lineHeight: 1.06, letterSpacing: -2 }}>
            {title}
          </div>
          {description && (
            <div style={{ fontSize: 30, color: '#475569', lineHeight: 1.35, maxHeight: 122, overflow: 'hidden' }}>
              {description}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', fontSize: 22, color: '#94a3b8' }}>onedef.cahidarda.com</div>
      </div>
    ),
    { ...ogSize, fonts: await loadFonts() },
  );
}
