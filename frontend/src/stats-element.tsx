// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { defineMosaicastElement, type MosaicastRender, type PluginContext } from '@mosaicast/plugin-sdk';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CardLine } from './components/CardLine';
import { EpisodeView } from './components/EpisodeView';
import { Overview } from './components/Overview';
import { StatsPage } from './components/StatsPage';

/**
 * Mounts a React tree once and re-renders it when the host hands over a new `ctx`, instead of tearing it
 * down (the SDK's MosaicastHandle). Keeps the manage page's half-filled forms and upload progress alive.
 */
const reactElement =
  (node: (ctx: PluginContext) => ReactNode): MosaicastRender =>
  ({ ctx, root }) => {
    const reactRoot = createRoot(root);
    reactRoot.render(node(ctx));
    return {
      update: (next) => reactRoot.render(node(next)),
      destroy: () => reactRoot.unmount(),
    };
  };

/** episode / main: the full stats of one episode. */
defineMosaicastElement({ tag: 'stats-episode', render: reactElement((ctx) => <EpisodeView ctx={ctx} />) });

/** episode / card: the one-liner on a feed card. */
defineMosaicastElement({ tag: 'stats-card', render: reactElement((ctx) => <CardLine ctx={ctx} />) });

/** feed / feed and site / site: the aggregate for the episodes in that panel. */
defineMosaicastElement({ tag: 'stats-overview', render: reactElement((ctx) => <Overview ctx={ctx} />) });

/** site / page: /p/stats/… — overview, seasons, manage. */
defineMosaicastElement({ tag: 'stats-page', render: reactElement((ctx) => <StatsPage ctx={ctx} />) });
