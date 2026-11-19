import { GoogleAnalytics } from '@next/third-parties/google';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { siteName, siteUrl } from '@/lib/shared';

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: siteName,
  title: { default: `${siteName}: define your API once`, template: `%s · ${siteName}` },
  description:
    'Define your API once in TypeScript. Get REST with OpenAPI, a typed client, an MCP server, an MCP App, a CLI with login and TanStack Query helpers from it.',
  openGraph: { siteName, type: 'website' },
  twitter: { card: 'summary_large_image' },
};

// Google Analytics, only where the measurement ID is set: production on Vercel.
// Local builds and previews leave it unset and send nothing.
const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim() || undefined;

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  );
}
