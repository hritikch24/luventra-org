import { NextResponse, type NextRequest } from 'next/server';
import { recordEvent, type TelemetryInput } from '@/app/lib/telemetry-server';

/**
 * Telemetry ingest.
 *
 * Validation, geo extraction and the local-console fallback all live in
 * `telemetry-server`, so this route is only transport. It always answers 204:
 * the client is fire-and-forget and must never retry or surface an error into
 * a conversion flow, and a caller learns nothing from the response.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ok = new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ok;
  }
  if (typeof body !== 'object' || body === null) return ok;

  // Fields are all `unknown` on TelemetryInput and validated inside recordEvent,
  // so an arbitrary object is a legitimate input here.
  await recordEvent(body as TelemetryInput, request.headers);
  return ok;
}
