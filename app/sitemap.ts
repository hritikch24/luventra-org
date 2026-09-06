import { MetadataRoute } from 'next';
import { SEO_BANKS } from './lib/seo-banks-data';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://luventra.co';
  
  // Base core application utility routes
  const baseRoutes = [
    { url: baseUrl, lastModified: new Date() },
    { url: `${baseUrl}/dashboard`, lastModified: new Date() },
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
