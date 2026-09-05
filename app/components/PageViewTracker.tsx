'use client';

import { useEffect } from 'react';
import { track, type Surface } from '@/app/lib/telemetry';

/**
 * Records one page_view per mount. Rendered by the pages that matter rather
 * than globally, so /metrics and the legal routes are not counted as funnel
 * traffic.
 */
export function PageViewTracker({
  surface,
  bankSlug,
}: {
  readonly surface: Surface;
  readonly bankSlug?: string;
}) {
  useEffect(() => {
    track({ event: 'page_view', surface, ...(bankSlug ? { bankSlug } : {}) });
  }, [surface, bankSlug]);

  return null;
}
