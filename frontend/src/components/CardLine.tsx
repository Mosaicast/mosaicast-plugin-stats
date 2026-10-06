// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import * as fmt from '../format';
import { Root, ShareBar, useSiteData } from './common';

/**
 * The one-liner on a feed card: a small share bar and "Alex 53 % · Max 47 %". Reads the site index, which
 * every card on the page shares, instead of one request per card. Renders nothing without stats.
 */
export function CardLine({ ctx }: { ctx: PluginContext }) {
  const { index, basics: b } = useSiteData(ctx);
  // A card has no room for a picker: it shows the first bundle without spoilers that has data.
  const byBundle = index?.episodes?.[ctx.scope.id] ?? {};
  const bundle = b.bundles.find((x) => x.kind === 'podcast' && !x.spoiler && byBundle[x.id]);
  const stats = bundle ? byBundle[bundle.id] : undefined;
  if (!stats || stats.speakers.length === 0) return null;
  const top = stats.speakers.slice(0, 3);
  const text = top.map((s) => `${b.who(s.key, s).name} ${fmt.percent(s.share, b.locale)}`).join(' · ');
  return (
    <Root>
      <div className="card-line" title={b.t('card.title')}>
        <ShareBar parts={stats.speakers} b={b} thin legend={false} />
        <span className="txt">{text}</span>
      </div>
    </Root>
  );
}
