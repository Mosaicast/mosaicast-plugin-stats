// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bundle, ViewChoice } from './types';

const SESSION_KEY = 'mc.stats.view';
const USER_KEY = 'view';
const EVENT = 'mc-stats-view';
const DEFAULT: ViewChoice = { bundles: null, spoilers: false };

/**
 * Where a visitor's choice is kept. Signed in: their own per-user document on the server, so it follows
 * them and nothing lands on the device. Anonymous: `sessionStorage` only, gone with the tab, written only
 * when they change something (declared in the manifest as necessary, see README "Remembering the choice").
 */
async function load(ctx: PluginContext): Promise<ViewChoice> {
  if (ctx.user) {
    try {
      return { ...DEFAULT, ...((await ctx.docs.get<ViewChoice>('self', USER_KEY)) ?? {}) };
    } catch {
      return DEFAULT;
    }
  }
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? { ...DEFAULT, ...(JSON.parse(raw) as ViewChoice) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function save(ctx: PluginContext, choice: ViewChoice): void {
  if (ctx.user) {
    void ctx.docs.put('self', USER_KEY, choice).catch((e: unknown) => ctx.log('warn', `stats: could not save the view (${String(e)})`));
  } else {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(choice));
    } catch {
      // Private mode or storage switched off: the choice just lasts as long as the page.
    }
  }
  // Other stats tiles on the same page follow along.
  window.dispatchEvent(new CustomEvent<ViewChoice>(EVENT, { detail: choice }));
}

/** The bundles a choice selects, out of those available. Spoiler bundles only count with spoilers on. */
export function effective(choice: ViewChoice, available: Bundle[]): Set<string> {
  const allowed = available.filter((b) => choice.spoilers || !b.spoiler);
  if (choice.bundles === null) return new Set(allowed.filter((b) => !b.spoiler || choice.spoilers).map((b) => b.id));
  return new Set(allowed.filter((b) => choice.bundles!.includes(b.id)).map((b) => b.id));
}

/** The visitor's bundle and spoiler choice, loaded once and kept in step across tiles. */
export function useViewChoice(ctx: PluginContext, available: Bundle[]) {
  const [choice, setChoice] = useState<ViewChoice>(DEFAULT);
  useEffect(() => {
    let live = true;
    void load(ctx).then((c) => live && setChoice(c));
    const follow = (e: Event) => setChoice((e as CustomEvent<ViewChoice>).detail);
    window.addEventListener(EVENT, follow);
    return () => {
      live = false;
      window.removeEventListener(EVENT, follow);
    };
  }, [ctx.docs, ctx.user?.id]);

  const selected = useMemo(() => effective(choice, available), [choice, available]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const c = { ...choice, bundles: [...next] };
      setChoice(c);
      save(ctx, c);
    },
    [choice, selected, ctx],
  );

  const setSpoilers = useCallback(
    (on: boolean) => {
      // Turning spoilers on also ticks the spoiler bundles, otherwise the switch would seem to do nothing.
      const base = new Set(selected);
      for (const b of available) if (b.spoiler) on ? base.add(b.id) : base.delete(b.id);
      const c = { bundles: [...base], spoilers: on };
      setChoice(c);
      save(ctx, c);
    },
    [selected, available, ctx],
  );

  return { choice, selected, toggle, setSpoilers };
}
