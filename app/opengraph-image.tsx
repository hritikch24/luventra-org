import { ImageResponse } from 'next/og';

/**
 * The social card, generated at build time for every route that does not
 * declare its own.
 *
 * Until now the site shipped og:title and og:description but no image, so a
 * link pasted into Slack, LinkedIn or a WhatsApp group rendered as bare text
 * next to competitors showing a card.
 *
 * The mark is rebuilt here out of plain divs rather than the SVG in
 * app/icon.svg. This renders through Satori, which supports only a subset of
 * SVG, and the mark is six rectangles and a rule — so divs reproduce it exactly
 * with nothing left to a renderer quirk. The geometry is the same 32-unit grid
 * scaled up: ragged rules on the left, flush rules on the right, the engine
 * seam between them.
 */

export const alt = 'Luventra — convert bank CSV statements to OFX, QBO and QFX in your browser';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ZINC_950 = '#09090b';
const ZINC_800 = '#27272a';
const ZINC_600 = '#52525b';
const ZINC_400 = '#a1a1aa';
const ZINC_100 = '#f4f4f5';
const EMERALD = '#10b981';

/** One rule in the mark. `u` is the 32-grid unit in final pixels. */
function Rule({ w, colour, u }: { w: number; colour: string; u: number }) {
  return <div style={{ width: w * u, height: 3 * u, background: colour, borderRadius: 1 }} />;
}

export default function OpengraphImage() {
  const u = 7; // 32-unit grid -> 224px mark

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: ZINC_950,
          padding: 64,
          fontFamily: 'monospace',
        }}
      >
        {/* Mark + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 * u }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2.5 * u, alignItems: 'flex-start' }}>
              <Rule w={8} colour={ZINC_600} u={u} />
              <Rule w={4} colour={ZINC_600} u={u} />
              <Rule w={6.5} colour={ZINC_600} u={u} />
            </div>
            <div style={{ width: 2, height: 17 * u, background: ZINC_800 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2.5 * u }}>
              <Rule w={8} colour={EMERALD} u={u} />
              <Rule w={8} colour={EMERALD} u={u} />
              <Rule w={8} colour={EMERALD} u={u} />
            </div>
          </div>
        </div>

        {/* Statement */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 26, letterSpacing: 6, color: ZINC_400 }}>
            LUVENTRA // CORE FILE ENGINE
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 60,
              lineHeight: 1.15,
              letterSpacing: -1.5,
              color: ZINC_100,
              maxWidth: 940,
            }}
          >
            Bank CSV to OFX, QBO and QFX — converted in your browser
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: ZINC_400, letterSpacing: -0.2 }}>
            Nothing is uploaded. Parsing runs in a local Web Worker.
          </div>
        </div>

        {/* Compliance strip, mirroring the app's own footer row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 21, color: ZINC_600 }}>
          <div style={{ display: 'flex' }}>[ OFX SGML 1.0.2 ]</div>
          <div style={{ display: 'flex' }}>[ INTUIT BID ]</div>
          <div style={{ display: 'flex' }}>[ SHA-1 DEDUPLICATION ]</div>
        </div>
      </div>
    ),
    size,
  );
}
