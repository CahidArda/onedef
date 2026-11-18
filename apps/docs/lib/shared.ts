import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'onedef';

/** Where the site is served; Open Graph and Twitter need absolute image URLs. */
export const siteUrl = new URL(
  process.env.SITE_URL?.trim() || 'https://onedef.cahidarda.com',
);
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';

export const gitConfig = {
  user: 'CahidArda',
  repo: 'onedef',
  branch: 'main',
  /** Where the docs content lives in the repo, for "edit on GitHub" links. */
  contentDir: 'apps/docs/content/docs',
};

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
