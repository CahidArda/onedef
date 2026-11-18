import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/shared';

// Crawl everything people read; skip the search API. The sitemap lists every page.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    host: siteUrl.origin,
  };
}
