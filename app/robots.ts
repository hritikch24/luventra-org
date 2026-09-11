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
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: '/api/',
      },
      /*
       * The answer-engine crawlers, named explicitly.
       *
       * The wildcard above already permits them, so this grants no new access
       * — it states the intent. These agents are the ones a host or CDN is
       * most likely to start blocking by default, and an explicit allow means
       * that decision has to be made here rather than inherited silently. It
       * is also the switch to flip if the position ever changes: deny one of
       * these and that engine stops being able to describe the tool at all.
       */
      {
        userAgent: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'],
        allow: '/',
        disallow: '/api/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
