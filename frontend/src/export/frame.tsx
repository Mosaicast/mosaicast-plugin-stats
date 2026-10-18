// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { forwardRef, useId, type ReactNode } from 'react';
import { mix, PADDING } from './design';
import type { ExportFormat } from './formats';
import { font, Paragraph, paragraphHeight, Text, type Box, type Kit } from './kit';
import { fit, fitSize, textWidth } from './measure';
import { displayUrl, qrModules } from './render';

export interface FrameTexts {
  headline: string;
  subline: string;
  /** Above the URL in the footer. */
  linkLabel: string;
  /** A small badge next to the brand, e.g. "Spoilers". */
  badge?: string | null;
}

/**
 * The whole image: background, brand row, headline, the template's content and a footer with the link
 * (and a QR code to it). The content gets what's left between header and footer, inside the format's safe
 * margins. Rendered as the preview in the dialog and serialised for the file, so it holds only plain SVG.
 */
export const Frame = forwardRef<SVGSVGElement, {
  format: ExportFormat;
  k: Kit;
  texts: FrameTexts;
  logo: string | null;
  url: string;
  children: (box: Box) => ReactNode;
  label: string;
}>(function Frame({ format, k, texts, logo, url, children, label }, ref) {
  const { width: W, height: H, safe } = format;
  const { d, g, u } = k;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const short = Math.min(W, H);
  const p = PADDING[d.density] * short;
  // A safe margin already keeps content off the edge; padding only where there is none.
  const left = Math.max(safe.left, p);
  const right = W - Math.max(safe.right, p);
  const top = Math.max(safe.top, p);
  const bottom = H - Math.max(safe.bottom, p);
  const cw = right - left;
  const wide = W > H * 1.3;
  // Square and landscape images have little height to spare: a smaller header and footer.
  const tight = H <= W * 1.05;

  // Header: logo and brand, then headline and subline.
  let y = top;
  const showLogo = d.showLogo && !!logo;
  const brand = d.showBrand ? d.brand.trim() : '';
  const rowH = showLogo ? (tight ? 64 : 84) * u : brand || texts.badge ? (tight ? 34 : 40) * u : 0;
  const brandSize = (tight ? 28 : 32) * u;
  const badgeSize = 24 * u;
  const badgeW = texts.badge ? textWidth(texts.badge, font(k, badgeSize, 700)) + 36 * g : 0;
  const brandX = left + (showLogo ? rowH + 22 * g : 0);
  const header: ReactNode[] = [];
  if (rowH > 0) {
    if (showLogo) {
      header.push(
        <g key="logo">
          <clipPath id={`${id}-logo`}><rect x={left} y={y} width={rowH} height={rowH} rx={Math.min(d.radius * g, rowH / 2) * 0.6} /></clipPath>
          <image href={logo!} x={left} y={y} width={rowH} height={rowH} preserveAspectRatio="xMidYMid meet" clipPath={`url(#${id}-logo)`} />
        </g>,
      );
    }
    if (brand) {
      header.push(
        <Text key="brand" k={k} x={brandX} y={y + rowH / 2 + brandSize * 0.35} size={brandSize} weight={700} fill={d.muted}>
          {fit(brand, right - brandX - badgeW - 20 * g, font(k, brandSize, 700))}
        </Text>,
      );
    }
    if (texts.badge) {
      const bh = badgeSize * 1.9;
      header.push(
        <g key="badge">
          <rect x={right - badgeW} y={y + rowH / 2 - bh / 2} width={badgeW} height={bh} rx={bh / 2} fill={d.accent} />
          <Text k={k} x={right - badgeW / 2} y={y + rowH / 2 + badgeSize * 0.35} size={badgeSize} weight={700} fill={d.accentContrast} anchor="middle">
            {texts.badge}
          </Text>
        </g>,
      );
    }
    y += rowH + (tight ? 24 : 40) * g;
  }
  const headSize = (tight ? 64 : 84) * u;
  const headline = texts.headline.trim();
  if (headline) {
    header.push(<Paragraph key="h" k={k} x={left} y={y} w={cw} text={headline} size={headSize} weight={800} lines={wide ? 2 : 3} lineHeight={1.08} />);
    y += paragraphHeight(k, headline, cw, headSize, 800, wide ? 2 : 3, 1.08);
  }
  const subSize = (tight ? 30 : 36) * u;
  const subline = texts.subline.trim();
  if (subline) {
    y += (tight ? 8 : 14) * g;
    header.push(<Paragraph key="s" k={k} x={left} y={y} w={cw} text={subline} size={subSize} fill={d.muted} lines={2} lineHeight={1.25} />);
    y += paragraphHeight(k, subline, cw, subSize, 400, 2, 1.25);
  }
  y += (tight ? 30 : 52) * g;

  // Footer: QR code and the link, from the bottom up.
  const qrSize = d.showQr ? (tight ? 124 : 150) * g : 0;
  const footerH = d.showQr ? qrSize : d.showLink ? (tight ? 64 : 76) * u : 0;
  const footerY = bottom - footerH;
  const footer: ReactNode[] = [];
  if (d.showQr) footer.push(<Qr key="qr" x={left} y={footerY} size={qrSize} url={url} radius={Math.min(d.radius, 24) * g} />);
  if (d.showLink) {
    const tx = left + (d.showQr ? qrSize + 30 * g : 0);
    const room = right - tx;
    const shown = displayUrl(url);
    const urlSize = fitSize(shown, room, font(k, (tight ? 30 : 36) * u, 700), 18 * u);
    const labelSize = (tight ? 24 : 28) * u;
    const mid = footerY + footerH / 2;
    footer.push(
      <g key="link">
        <Text k={k} x={tx} y={mid - urlSize * 0.25} size={labelSize} fill={d.muted}>{fit(texts.linkLabel, room, font(k, labelSize))}</Text>
        <Text k={k} x={tx} y={mid + urlSize * 1.05} size={urlSize} weight={700}>{fit(shown, room, font(k, urlSize, 700))}</Text>
      </g>,
    );
  }
  const contentBottom = footerH > 0 ? footerY - (tight ? 30 : 52) * g : bottom;
  const content: Box = { x: left, y, w: cw, h: Math.max(0, contentBottom - y) };

  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Background id={id} k={k} w={W} h={H} />
      {header}
      {content.h > 0 && children(content)}
      {footer}
    </svg>
  );
});

function Background({ id, k, w, h }: { id: string; k: Kit; w: number; h: number }) {
  const { d, g } = k;
  const base = <rect width={w} height={h} fill={d.bg} />;
  switch (d.background) {
    case 'gradient': {
      const a = (d.angle * Math.PI) / 180;
      const dx = Math.sin(a) / 2;
      const dy = -Math.cos(a) / 2;
      return (
        <>
          <defs>
            <linearGradient id={`${id}-bg`} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
              <stop offset="0" stopColor={d.bg} />
              <stop offset="1" stopColor={d.bg2} />
            </linearGradient>
          </defs>
          <rect width={w} height={h} fill={`url(#${id}-bg)`} />
        </>
      );
    }
    case 'glow':
      return (
        <>
          <defs>
            <radialGradient id={`${id}-g1`} cx="0.9" cy="0.05" r="0.75">
              <stop offset="0" stopColor={d.bg2} stopOpacity="0.95" />
              <stop offset="1" stopColor={d.bg2} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-g2`} cx="0.05" cy="1" r="0.7">
              <stop offset="0" stopColor={d.accent} stopOpacity="0.35" />
              <stop offset="1" stopColor={d.accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          {base}
          <rect width={w} height={h} fill={`url(#${id}-g1)`} />
          <rect width={w} height={h} fill={`url(#${id}-g2)`} />
        </>
      );
    case 'dots':
    case 'grid': {
      const step = (d.background === 'dots' ? 36 : 72) * g;
      const ink = mix(d.text, d.bg, 0.88);
      return (
        <>
          <defs>
            <pattern id={`${id}-p`} width={step} height={step} patternUnits="userSpaceOnUse">
              {d.background === 'dots'
                ? <circle cx={step / 2} cy={step / 2} r={3 * g} fill={ink} />
                : <path d={`M ${step} 0 H 0 V ${step}`} fill="none" stroke={ink} strokeWidth={1.5 * g} />}
            </pattern>
          </defs>
          {base}
          <rect width={w} height={h} fill={`url(#${id}-p)`} />
        </>
      );
    }
    default:
      return base;
  }
}

/**
 * The link as a QR code: dark modules on white with a quiet zone, whatever the design's colours, because
 * scanners want contrast more than they want a palette.
 */
function Qr({ x, y, size, url, radius }: { x: number; y: number; size: number; url: string; radius: number }) {
  const modules = qrModules(url);
  const n = modules.length;
  const quiet = 2;
  const m = size / (n + quiet * 2);
  let d = '';
  modules.forEach((row, r) => {
    let c = 0;
    while (c < n) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && row[c]) c++;
      d += `M${(start + quiet) * m} ${(r + quiet) * m}h${(c - start) * m}v${m}h${-(c - start) * m}z`;
    }
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={size} height={size} rx={radius} fill="#ffffff" />
      <path d={d} fill="#111111" shapeRendering="crispEdges" />
    </g>
  );
}
