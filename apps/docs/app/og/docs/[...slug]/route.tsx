import { notFound } from 'next/navigation';
import { ogImage, sectionOf } from '@/lib/og';
import { getPageImageUrl } from '@/lib/shared';
import { source } from '@/lib/source';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const slugs = slug.slice(0, -1);
  const page = source.getPage(slugs);
  if (!page) notFound();

  return ogImage({
    title: page.data.title,
    description: page.data.description,
    section: sectionOf(slugs),
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }));
}
