import type { MetadataRoute } from 'next';
import { SEO_BANKS } from './lib/seo-banks-data';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://luventra.co';
  
  // Base core application utility routes
  const baseRoutes = [
    // The landing page. /dashboard is deliberately absent: it is noindex, and
    // listing a noindexed URL in a sitemap asks a crawler to fetch something
    // it is then told to discard.
    { url: baseUrl, lastModified: new Date() },
    // The bank index. Omitting it was a real gap: Search Console reported
    // /banks as "URL is unknown to Google" with "No referring sitemaps
    // detected", even though it is the hub linking to all 20 bank pages and
    // therefore the cheapest single page for a crawler to enter the section
    // through. Every page it links to was in the sitemap; the hub itself
    // was not.
    { url: `${baseUrl}/banks`, lastModified: new Date() },
    { url: `${baseUrl}/privacy`, lastModified: new Date() },
    { url: `${baseUrl}/terms`, lastModified: new Date() },
  ];

  // Dynamic programmatic SEO bank landing directory paths
  const bankRoutes = SEO_BANKS.map((bank) => ({
    url: `${baseUrl}/banks/${bank.slug}`,
    lastModified: new Date(),
  }));

  return [...baseRoutes, ...bankRoutes];
}
