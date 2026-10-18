// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon, type Basics } from '../components/common';
import { canManage } from '../data';
import type { SeasonLookup } from '../seasons';
import type { BundleSettings, SpeakerSettings, StatsIndex } from '../types';
import { ExportDialog } from './ExportDialog';
import type { ExportArea } from './items';

/** Which stats a page shows, for the export dialog: the same episodes, scope and URL as the page. */
export interface ExportScope {
  area: ExportArea;
  slugs: string[];
  /** Whole show: season of each episode (the season comparison needs it). */
  seasonOf?: SeasonLookup;
  /** A season page: its number. */
  season?: number | null;
  /** One book's page: its URL name. */
  only?: string | null;
  /** The episode page: its slug. */
  slug?: string | null;
  /** Root-relative URL of the page, for the link and QR code in the image. */
  path: string;
}

interface ExportApi {
  open: (item: string) => void;
  label: string;
  hint: string;
}

const Ctx = createContext<ExportApi | null>(null);

/** Who may export images: the same people who manage the stats. */
export function canExport(ctx: PluginContext): boolean {
  return canManage(ctx);
}

/**
 * Makes the export buttons inside it work, and holds the dialog. For visitors (and while the index loads)
 * it provides nothing, so `ExportButton`s inside draw nothing.
 */
export function ExportProvider({ ctx, index, settings, bundleSettings, selected, scope, b, children }: {
  ctx: PluginContext;
  index: StatsIndex | null | undefined;
  settings: SpeakerSettings | null;
  bundleSettings: BundleSettings | null;
  /** The page's bundle choice, where the dialog's own choice starts. */
  selected: Set<string>;
  scope: ExportScope;
  /** The page's translator. */
  b: Basics;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const api = useMemo<ExportApi>(() => ({ open: setOpen, label: b.t('export.button'), hint: b.t('export.buttonHint') }), [b]);
  // Always the same tree, so the page below doesn't remount when the index arrives.
  const enabled = canExport(ctx) && !!index;
  return (
    <Ctx.Provider value={enabled ? api : null}>
      {children}
      {enabled && open && (
        <ExportDialog ctx={ctx} index={index} settings={settings} bundleSettings={bundleSettings} selected={selected}
          scope={scope} item={open} ui={b} onClose={() => setOpen(null)} />
      )}
    </Ctx.Provider>
  );
}

/** "Image" button next to an exportable stat; nothing outside an `ExportProvider` or for visitors. */
export function ExportButton({ item }: { item: string }) {
  const api = useContext(Ctx);
  if (!api) return null;
  return (
    <button type="button" className="export-btn" onClick={() => api.open(item)} title={api.hint} aria-label={api.hint}>
      <Icon name="image" />
      <span className="export-btn-text" aria-hidden="true">{api.label}</span>
    </button>
  );
}

/** A right-aligned row with one export button, for stats without a heading of their own (tiles). */
export function ExportRow({ item }: { item: string }) {
  if (!useContext(Ctx)) return null;
  return (
    <div className="export-row">
      <ExportButton item={item} />
    </div>
  );
}
