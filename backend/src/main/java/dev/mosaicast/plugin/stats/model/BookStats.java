// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import dev.mosaicast.plugin.stats.model.EntityGroup.EntityCount;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Stats of a book, chapter by chapter. Only counts and names: no sentence, paragraph or summary of the book
 * ever leaves the archive.
 *
 * @param model    {@link #MODEL} when read
 * @param source   where the numbers came from
 * @param title    the book's title as the source names it
 * @param language detected language (ISO 639-1), if known
 * @param chapters in book order
 * @param warnings things the reader had to work around
 */
public record BookStats(int model, Source source, String title, String language, List<Chapter> chapters,
                        List<Warning> warnings) {

    /**
     * Version of the book shape. 2 added sentence numbers and places/groups per chapter, 3 the chapter group;
     * a book read with an older model is read again from its archive at start-up.
     */
    public static final int MODEL = 3;

    /** Names kept per chapter, and per summary. */
    public static final int TOP = 15;

    public BookStats {
        chapters = chapters == null ? List.of() : List.copyOf(chapters);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }

    /**
     * One chapter.
     *
     * @param id              stable within this book ({@code c0}, {@code c1}, …)
     * @param index           position in the book, from 0
     * @param heading         the chapter heading, e.g. "Jaime I"
     * @param group           the heading this chapter shares with others of the book, e.g. "Jaime" for "Jaime
     *                        I"; null when no other chapter has it, or every chapter does
     * @param words           words in the chapter
     * @param sentences       sentences, if the source split them
     * @param paragraphs      paragraphs
     * @param longestSentence words in the longest sentence, if sentences are known
     * @param dialogue        sentences with direct speech in them, if sentences are known
     * @param questions       sentences ending in a question mark, if sentences are known
     * @param characters      most mentioned characters in this chapter
     * @param newCharacters   characters mentioned here for the first time in the book
     * @param entities        most mentioned places, groups, … (not people, not dates) by label
     */
    public record Chapter(String id, int index, String heading, String group, int words, Integer sentences,
                          int paragraphs, Integer longestSentence, Integer dialogue, Integer questions,
                          List<EntityCount> characters, List<EntityCount> newCharacters, List<EntityGroup> entities) {

        public Chapter {
            characters = characters == null ? List.of() : List.copyOf(characters);
            newCharacters = newCharacters == null ? List.of() : List.copyOf(newCharacters);
            entities = entities == null ? List.of() : List.copyOf(entities);
        }
    }

    /** Light outline for the import list: headings and lengths, nothing else. */
    public Outline outline() {
        return new Outline(title, chapters.stream().map(c -> new ChapterRef(c.id(), c.heading(), c.words())).toList());
    }

    /**
     * The chapters with the given ids, in book order; all of them for {@code null} or an empty list.
     *
     * @param ids chapter ids, as in {@link Chapter#id()}
     */
    public BookStats only(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return this;
        }
        Set<String> wanted = Set.copyOf(ids);
        return new BookStats(model, source, title, language,
                chapters.stream().filter(c -> wanted.contains(c.id())).toList(), warnings);
    }

    /** What the site index keeps for a set of chapters: totals, per-chapter numbers, merged top names. */
    public Summary summary() {
        int words = 0;
        int paragraphs = 0;
        Integer sentences = 0;
        Integer dialogue = 0;
        Integer questions = 0;
        Integer longest = null;
        Map<String, Integer> characters = new LinkedHashMap<>();
        Map<String, Integer> newcomers = new LinkedHashMap<>();
        Map<String, Map<String, Integer>> entities = new LinkedHashMap<>();
        List<ChapterNumbers> numbers = new ArrayList<>();
        for (Chapter c : chapters) {
            words += c.words();
            paragraphs += c.paragraphs();
            sentences = add(sentences, c.sentences());
            dialogue = add(dialogue, c.dialogue());
            questions = add(questions, c.questions());
            if (c.longestSentence() != null && (longest == null || c.longestSentence() > longest)) {
                longest = c.longestSentence();
            }
            c.characters().forEach(e -> characters.merge(e.text(), e.count(), Integer::sum));
            c.newCharacters().forEach(e -> newcomers.merge(e.text(), e.count(), Integer::sum));
            c.entities().forEach(g -> g.top().forEach(e -> entities
                    .computeIfAbsent(g.label(), k -> new LinkedHashMap<>()).merge(e.text(), e.count(), Integer::sum)));
            numbers.add(new ChapterNumbers(c.id(), c.index(), c.heading(), c.group(), c.words(), c.sentences(),
                    c.paragraphs(), c.longestSentence(), c.dialogue(), c.questions()));
        }
        List<EntityGroup> groups = new ArrayList<>();
        entities.forEach((label, counts) -> groups.add(new EntityGroup(label, top(counts))));
        return new Summary(slug(title), title, numbers, words, sentences, paragraphs, longest, dialogue, questions,
                top(characters), top(newcomers), groups);
    }

    /** Null as soon as one part is unknown: a total over some chapters would read as the whole. */
    private static Integer add(Integer sum, Integer part) {
        return sum == null || part == null ? null : sum + part;
    }

    static List<EntityCount> top(Map<String, Integer> counts) {
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()))
                .limit(TOP)
                .map(e -> new EntityCount(e.getKey(), e.getValue()))
                .sorted(Comparator.comparingInt(EntityCount::count).reversed())
                .toList();
    }

    /**
     * The URL name of a book: its title in lower case ASCII, words joined by dashes ("Das Lied von Eis und
     * Feuer 05" → {@code das-lied-von-eis-und-feuer-05}); {@code book} without a usable title. The page
     * {@code /p/stats/books/<slug>} is found by it.
     *
     * @param title the book's title, may be null
     */
    public static String slug(String title) {
        if (title == null) {
            return "book";
        }
        String plain = Normalizer.normalize(title.replace("ß", "ss"), Normalizer.Form.NFKD).replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        if (plain.length() > 80) {
            plain = plain.substring(0, 80).replaceAll("-+$", "");
        }
        return plain.isEmpty() ? "book" : plain;
    }

    /**
     * The import list's view of a book.
     *
     * @param title    the book
     * @param chapters headings and lengths
     */
    public record Outline(String title, List<ChapterRef> chapters) {

        public Outline {
            chapters = chapters == null ? List.of() : List.copyOf(chapters);
        }
    }

    /**
     * A chapter as the import list shows it.
     *
     * @param id      chapter id
     * @param heading chapter heading
     * @param words   its length
     */
    public record ChapterRef(String id, String heading, int words) {
    }

    /**
     * The numbers of one chapter, without names.
     *
     * @param id              chapter id
     * @param index           position in the book
     * @param heading         chapter heading
     * @param group           the heading it shares with other chapters of the book, if any (see {@link Chapter})
     * @param words           words
     * @param sentences       sentences, if known
     * @param paragraphs      paragraphs
     * @param longestSentence words in the longest sentence, if known
     * @param dialogue        sentences with direct speech, if known
     * @param questions       questions, if known
     */
    public record ChapterNumbers(String id, int index, String heading, String group, int words, Integer sentences,
                                 int paragraphs, Integer longestSentence, Integer dialogue, Integer questions) {
    }

    /**
     * A set of chapters (what one episode covers) in the site index.
     *
     * @param book            {@link #slug(String)} of the title, the same for every part of one book
     * @param title           the book
     * @param chapters        per-chapter numbers
     * @param words           total words
     * @param sentences       total sentences, if known for every chapter
     * @param paragraphs      total paragraphs
     * @param longestSentence the longest sentence in these chapters, in words
     * @param dialogue        sentences with direct speech, if known for every chapter
     * @param questions       questions, if known for every chapter
     * @param characters      most mentioned characters across these chapters
     * @param newCharacters   characters first mentioned in these chapters
     * @param entities        most mentioned places, groups, … across these chapters
     */
    public record Summary(String book, String title, List<ChapterNumbers> chapters, int words, Integer sentences,
                          int paragraphs, Integer longestSentence, Integer dialogue, Integer questions,
                          List<EntityCount> characters, List<EntityCount> newCharacters, List<EntityGroup> entities) {

        public Summary {
            chapters = chapters == null ? List.of() : List.copyOf(chapters);
            characters = characters == null ? List.of() : List.copyOf(characters);
            newCharacters = newCharacters == null ? List.of() : List.copyOf(newCharacters);
            entities = entities == null ? List.of() : List.copyOf(entities);
        }
    }
}
