// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import * as fmt from '../format';
import type { ChapterRecordId } from '../book';
import type { RecordId } from '../records';
import type { Basics } from './common';

const length = (v: number, b: Basics) => (v < 60 ? fmt.pause(v, b.locale) : fmt.clock(v));
const share = (v: number, b: Basics) => fmt.percent(v, b.locale);
const wpm = (v: number, b: Basics) => b.t('unit.wpm', { n: fmt.count(v, b.locale) });

/** How each record's value reads. */
export const VALUE: Record<RecordId, (v: number, b: Basics) => string> = {
  longest: length,
  shortest: length,
  words: (v, b) => b.t('unit.words', { n: fmt.count(v, b.locale) }),
  pace: wpm,
  laughs: (v, b) => fmt.count(v, b.locale),
  questions: (v, b) => fmt.count(v, b.locale),
  backAndForth: (v, b) => b.t('unit.perMinute', { n: fmt.decimal(v, b.locale) }),
  crosstalk: length,
  pause: (v, b) => fmt.pause(v, b.locale),
  oneSided: share,
  balanced: share,
  fastest: wpm,
  slowest: wpm,
  asks: (v, b) => fmt.count(v, b.locale),
  monologue: length,
};

/** And the second number, where there is one. */
export const EXTRA: Partial<Record<RecordId, (v: number, b: Basics) => string>> = {
  laughs: (v, b) => b.t('tile.perHour', { n: fmt.decimal(v, b.locale) }),
  backAndForth: (v, b) => b.t('unit.turns', { n: fmt.count(v, b.locale) }),
  fastest: (v, b) => b.t('unit.words', { n: fmt.count(v, b.locale) }),
  slowest: (v, b) => b.t('unit.words', { n: fmt.count(v, b.locale) }),
  asks: (v, b) => b.t('unit.perSpeakingHour', { n: fmt.decimal(v, b.locale) }),
};

/** How a chapter record's value reads. */
export function chapterValue(id: ChapterRecordId, v: number, b: Basics): string {
  switch (id) {
    case 'wordiest':
      return b.t('books.perSentence', { n: fmt.decimal(v, b.locale) });
    case 'mostDialogue':
    case 'leastDialogue':
      return fmt.percent(v, b.locale);
    case 'mostQuestions':
      return fmt.count(v, b.locale);
    default:
      return b.t('book.wordCount', { n: fmt.count(v, b.locale) });
  }
}
