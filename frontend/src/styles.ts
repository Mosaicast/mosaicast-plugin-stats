// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { iconCss } from '@mosaicast/plugin-sdk';

/** Host icons this plugin draws (published by core as --mc-icon-*). */
export const ICONS = [
  'chart-bar', 'upload', 'warning', 'check', 'delete', 'refresh', 'arrow-right', 'arrow-left', 'people', 'clock',
  'settings', 'info', 'book', 'close',
] as const;

/**
 * Shared styles for every element. Each element renders into its own shadow root, so this goes in a
 * <style> per root. Colours come from the host's theme tokens; speaker colours are the only hard-coded
 * ones (see palette.ts).
 */
export const CSS = `
:host { display: block; color: var(--mc-text); font: inherit; }
* { box-sizing: border-box; }
${iconCss([...ICONS], { className: 'ic' })}
.ic { flex: none; vertical-align: -0.125em; }

.panel { background: var(--mc-surface); border: 1px solid var(--mc-border); border-radius: 12px; padding: 20px; }
.panel + .panel { margin-top: 16px; }
.panel.flat { background: none; border: 0; padding: 0; }
h2, h3 { margin: 0; line-height: 1.25; font-weight: 600; }
h2 { font-size: 1.2rem; }
h3 { font-size: 1rem; margin-bottom: 10px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.muted { color: var(--mc-text-muted); }
.small { font-size: 0.85rem; }
.tiny { font-size: 0.78rem; }
a { color: var(--mc-accent-text); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--mc-accent-text); outline-offset: 2px;
}
.section { margin-top: 22px; }
.section:first-child { margin-top: 0; }

/* loading */
.loading { height: 3px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--mc-border) 70%, transparent); }
.loading::after { content: ''; display: block; height: 100%; width: 35%; border-radius: 2px; background: var(--mc-accent);
  animation: slide 1.1s ease-in-out infinite; }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) { .loading::after { animation: none; width: 100%; opacity: .5; } }

/* share bar: segments separated by a 2px surface gap */
.share { display: flex; gap: 2px; height: 14px; border-radius: 4px; overflow: hidden; }
.share > span { display: block; min-width: 2px; }
.share.thin { height: 8px; border-radius: 3px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; font-size: 0.9rem; }
.legend .item { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.legend .value { color: var(--mc-text-muted); font-variant-numeric: tabular-nums; }

/* tiles */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 10px; }
.tile { border: 1px solid var(--mc-border); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.tile .label { font-size: 0.8rem; color: var(--mc-text-muted); }
.tile .value { font-size: 1.3rem; font-weight: 600; margin-top: 2px; white-space: nowrap; overflow-wrap: anywhere; }
.tile .sub { font-size: 0.78rem; color: var(--mc-text-muted); margin-top: 2px; }
.tiles.compact { grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.tiles.compact .tile { padding: 8px 10px; }
.tiles.compact .value { font-size: 1.1rem; }

/* bundle picker */
.picker { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-bottom: 12px; font-size: 0.88rem; }
.picker .check { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; cursor: pointer; }
.picker .check input { width: 16px; height: 16px; margin: 0; accent-color: var(--mc-accent); }
.picker .spoiler { color: var(--mc-text-muted); }

/* label/value list for narrow panels */
.facts { margin: 14px 0 0; display: grid; gap: 6px; }
.facts > div { display: flex; justify-content: space-between; gap: 12px; font-size: 0.9rem; border-bottom: 1px solid var(--mc-border); padding-bottom: 6px; }
.facts > div:last-child { border-bottom: 0; padding-bottom: 0; }
.facts dt { color: var(--mc-text-muted); }
.facts dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }

/* tables */
/* width 0 + min-width 100 %: the table scrolls inside us instead of widening the host's column */
.table-wrap { overflow-x: auto; width: 0; min-width: 100%; position: relative; }
:host { position: relative; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: right; padding: 7px 10px; border-bottom: 1px solid var(--mc-border); white-space: nowrap; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { text-align: left; padding-left: 0; }
th.wrap { white-space: normal; min-width: 80px; max-width: 120px; }
th { font-weight: 600; color: var(--mc-text-muted); font-size: 0.8rem; }
tr:last-child td, tr:last-child th { border-bottom: 0; }
.who { display: inline-flex; align-items: center; gap: 8px; }

/* chips */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 10px; border-radius: 999px;
  border: 1px solid var(--mc-border); font-size: 0.88rem; }
.chip .n { color: var(--mc-text-muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
button.chip { background: none; color: inherit; font: inherit; font-size: 0.88rem; cursor: pointer; min-height: 32px; }
button.chip[aria-pressed='true'] { background: var(--mc-accent); color: var(--mc-accent-contrast); border-color: var(--mc-accent); }
button.chip[aria-pressed='true'] .n { color: inherit; opacity: .8; }
.page { max-width: 1080px; margin: 0 auto; padding: 24px 16px 48px; }

/* charts */
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart .grid { stroke: var(--mc-border); stroke-width: 1; }
.chart .axis { fill: var(--mc-text-muted); font-size: 11px; }
.chart .hit { fill: transparent; cursor: pointer; }
.chart .hit:hover, .chart .hit:focus { fill: color-mix(in srgb, var(--mc-text) 6%, transparent); outline: none; }
.tip { position: absolute; pointer-events: none; z-index: 2; background: var(--mc-surface); color: var(--mc-text);
  border: 1px solid var(--mc-border); border-radius: 8px; padding: 8px 10px; font-size: 0.82rem; line-height: 1.4;
  box-shadow: 0 4px 16px rgb(0 0 0 / .12); min-width: 150px; max-width: 260px; }
.tip .t { font-weight: 600; margin-bottom: 4px; }
.tip .row { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.tip .row span:first-child { display: inline-flex; align-items: center; gap: 6px; }

.chart-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.chart-head h3 { margin: 0; }
.chart .divider { stroke: var(--mc-text-muted); stroke-width: 1; stroke-dasharray: 3 3; }

/* books, chapter by chapter */
table.by-chapter td { text-align: left; white-space: normal; min-width: 140px; vertical-align: top; font-size: 0.86rem; }
table.by-chapter th[scope='row'] { vertical-align: top; min-width: 110px; white-space: normal; }
.names-list { list-style: none; margin: 0; padding: 0; }
.names-list li { white-space: normal; overflow-wrap: anywhere; line-height: 1.35; }
tr.book-start > * { border-top: 2px solid var(--mc-text-muted); }
table.heat { border-collapse: separate; border-spacing: 2px; width: auto; }
table.heat th, table.heat td { padding: 0; border: 0; }
table.heat thead th { font-size: 10px; font-weight: 400; text-align: center; height: 16px; }
table.heat .name-col { width: 132px; min-width: 132px; max-width: 132px; text-align: left; font-weight: 400; font-size: 0.82rem;
  color: var(--mc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 6px;
  position: sticky; left: 0; background: var(--mc-surface); z-index: 1; }
table.heat td { border-radius: 3px; background: color-mix(in srgb, var(--mc-border) 40%, transparent); }
table.heat td:focus { outline: 2px solid var(--mc-accent-text); outline-offset: 0; }
table.heat .start { border-left: 2px solid var(--mc-text-muted); }
table.heat td.l1, .heat-legend .l1 { background: color-mix(in srgb, var(--mc-accent-2) 30%, var(--mc-surface)); }
table.heat td.l2, .heat-legend .l2 { background: color-mix(in srgb, var(--mc-accent-2) 55%, var(--mc-surface)); }
table.heat td.l3, .heat-legend .l3 { background: color-mix(in srgb, var(--mc-accent-2) 78%, var(--mc-surface)); }
table.heat td.l4, .heat-legend .l4 { background: var(--mc-accent-2); }
th button.sort { all: unset; cursor: pointer; display: inline-flex; gap: 4px; align-items: baseline; }
th button.sort:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 2px; border-radius: 3px; }
th button.sort .arrow { font-size: 0.7rem; opacity: .55; }
th[aria-sort] button.sort .arrow { opacity: 1; }
table.pace td, table.pace th { vertical-align: top; }
.delta { display: inline-block; padding: 0 6px; border-radius: 999px; color: var(--mc-text); white-space: nowrap; }
.delta-less-1 { background: color-mix(in srgb, #2a78d6 14%, transparent); }
.delta-less-2 { background: color-mix(in srgb, #2a78d6 26%, transparent); }
.delta-less-3 { background: color-mix(in srgb, #2a78d6 40%, transparent); }
.delta-less-4 { background: color-mix(in srgb, #2a78d6 56%, transparent); }
.delta-more-1 { background: color-mix(in srgb, #eb6834 14%, transparent); }
.delta-more-2 { background: color-mix(in srgb, #eb6834 26%, transparent); }
.delta-more-3 { background: color-mix(in srgb, #eb6834 40%, transparent); }
.delta-more-4 { background: color-mix(in srgb, #eb6834 56%, transparent); }
.heat-legend { display: flex; align-items: center; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
.heat-legend .swatch { width: 14px; height: 12px; border-radius: 2px; display: inline-block; }

/* timeline */
.lanes { display: grid; grid-template-columns: max-content 1fr; gap: 6px 10px; align-items: center; }
.lane { position: relative; height: 16px; background: color-mix(in srgb, var(--mc-border) 45%, transparent); border-radius: 3px; overflow: hidden; cursor: pointer; }
.lane svg { display: block; width: 100%; height: 100%; }
.ticks { position: relative; height: 18px; }
.ticks .ev { position: absolute; top: 2px; transform: translateX(-50%); font-size: 12px; line-height: 1; }
.scale { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--mc-text-muted); margin-top: 4px; }

/* records */
.records { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
.record { border-left: 3px solid var(--mc-border); padding: 2px 0 2px 10px; min-width: 0; }
.record .label { font-size: 0.8rem; color: var(--mc-text-muted); }
.record .value { font-weight: 600; }
.record .where { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record button.link { margin-top: 2px; font-size: 0.8rem; }
dialog.ranking { border: 1px solid var(--mc-border); border-radius: 12px; padding: 0; background: var(--mc-surface); color: var(--mc-text);
  width: min(640px, calc(100vw - 32px)); max-height: min(80vh, 760px); box-shadow: 0 12px 40px rgb(0 0 0 / .25); }
dialog.ranking::backdrop { background: rgb(0 0 0 / .45); }
.ranking-body { padding: 16px 18px 18px; }
.ranking .row-head { align-items: center; }
.ranking .person { display: inline-flex; align-items: center; gap: 6px; }
.ranking tr.first td { background: color-mix(in srgb, var(--mc-accent) 8%, transparent); }

/* forms */
button.btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 0.9rem; padding: 7px 14px; min-height: 36px;
  border-radius: 8px; border: 1px solid var(--mc-border); background: var(--mc-surface); color: var(--mc-text); cursor: pointer; }
button.btn.primary { background: var(--mc-accent); border-color: var(--mc-accent); color: var(--mc-accent-contrast); }
button.btn:disabled { opacity: .55; cursor: default; }
button.link { background: none; border: 0; padding: 0; font: inherit; color: var(--mc-accent-text); cursor: pointer; }
button.link:disabled { color: var(--mc-text-muted); opacity: .45; cursor: not-allowed; }
select, input[type='text'] { font: inherit; font-size: 0.9rem; padding: 6px 8px; min-height: 36px; border-radius: 8px;
  border: 1px solid var(--mc-border); background: var(--mc-bg); color: var(--mc-text); max-width: 100%; }
.drop { border: 2px dashed var(--mc-border); border-radius: 12px; padding: 22px; text-align: center; transition: border-color .15s; }
.drop.over { border-color: var(--mc-accent); }
.note { display: flex; gap: 8px; align-items: flex-start; font-size: 0.88rem; padding: 8px 10px; border-radius: 8px;
  background: color-mix(in srgb, var(--mc-accent) 8%, var(--mc-surface)); }
.note.warn { background: color-mix(in srgb, #eda100 14%, var(--mc-surface)); }
.note.bad { background: color-mix(in srgb, #e34948 12%, var(--mc-surface)); }
.list { list-style: none; margin: 0; padding: 0; }
.list > li { border-top: 1px solid var(--mc-border); padding: 14px 0; }
.list > li:first-child { border-top: 0; }
.row-head { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
.status { font-size: 0.78rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--mc-border); white-space: nowrap; }
.status.assigned { border-color: color-mix(in srgb, #1baf7a 60%, var(--mc-border)); }
.status.failed { border-color: color-mix(in srgb, #e34948 60%, var(--mc-border)); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.card-line { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--mc-text-muted); min-width: 0; }
.card-line .share { width: 56px; flex: none; }
.card-line .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
