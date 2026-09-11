import type { MetadataRoute } from 'next';

/**
 * Crawl rules, served at /robots.txt by the metadata route convention.
 *
 * The `sitemap` field is the discovery path that was missing: until now the
 * sitemap at /sitemap.xml could only be found by submitting it in Search
 * Console by hand, because /robots.txt itself returned a 404.
 *
 * `baseUrl` falls back to the production host rather than localhost so the
 * emitted Sitemap: line is never a dead local URL if the env var is absent —
 * matching the fallback in sitemap.ts.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://luventra.co';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
