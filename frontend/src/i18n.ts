// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { createPluginI18n, type PluginContext, type PluginI18n } from '@mosaicast/plugin-sdk';
import { useEffect, useMemo } from 'react';
import en from '../locales/en.json';
import de from '../locales/de.json';

export const CATALOGS = { en, de };

/** A translator for the current locale, disposed with the component. */
export function useI18n(ctx: PluginContext): PluginI18n {
  const i18n = useMemo(() => createPluginI18n(CATALOGS, ctx.locale), [ctx.locale]);
  useEffect(() => () => i18n.dispose(), [i18n]);
  return i18n;
}
