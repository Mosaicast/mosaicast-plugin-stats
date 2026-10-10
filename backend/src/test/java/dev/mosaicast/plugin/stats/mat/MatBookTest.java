// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EntityGroup;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class MatBookTest {

    private static BookStats read(String json) {
        JsonNode root = JsonMapper.builder().build().readTree(json);
        return MatBook.read(root, null, List.of());
    }

    @Test
    void countsSentencesSpeechAndQuestions() {
        BookStats book = read("""
                {"title": "Test", "chapters": [{"heading": "Eins", "paragraphs": ["x"], "sentences": [
                  {"text": "„Komm her!“, rief sie.", "entities": []},
                  {"text": "»Wer bist du?«", "entities": []},
                  {"text": "Es regnete den ganzen Tag ueber Winterfell und niemand ging hinaus.", "entities": []},
                  {"text": "Don't you know?", "entities": []}
                ]}]}""");
        BookStats.Chapter c = book.chapters().getFirst();
        assertEquals(4, c.sentences());
        assertEquals(2, c.dialogue(), "an apostrophe isn't speech");
        assertEquals(2, c.questions(), "a question mark before the closing quote counts");
        assertEquals(11, c.longestSentence());
    }

    @Test
    void namesPlacesAndGroupsButNotPeopleOrDates() {
        BookStats book = read("""
                {"title": "Test", "chapters": [{"heading": "Eins", "paragraphs": ["x"], "sentences": [
                  {"text": "a", "entities": [{"label": "LOCATION", "text": "Winterfell"},
                    {"label": "LOCATION", "text": "winterfell"}, {"label": "PERSON", "text": "er"},
                    {"label": "DATE", "text": "morgen"}, {"label": "ORGANIZATION", "text": "Nachtwache"}]},
                  {"text": "b", "entities": [{"label": "LOCATION", "text": "Winterfell"},
                    {"label": "LOCATION", "text": "Hohenehr"}]}
                ]}]}""");
        List<EntityGroup> groups = book.chapters().getFirst().entities();
        assertEquals(List.of("LOCATION", "ORGANIZATION"), groups.stream().map(EntityGroup::label).toList());
        EntityGroup places = groups.getFirst();
        assertEquals("Winterfell", places.top().getFirst().text(), "the most common spelling is shown");
        assertEquals(3, places.top().getFirst().count());
        assertEquals(2, places.top().size());
    }

    @Test
    void withoutSentencesTheNumbersStayUnknown() {
        BookStats book = read("""
                {"title": "Test", "chapters": [{"heading": "Eins", "paragraphs": ["Ein Satz hier."]}]}""");
        BookStats.Chapter c = book.chapters().getFirst();
        assertNull(c.sentences());
        assertNull(c.dialogue());
        assertNull(c.longestSentence());
        assertTrue(c.entities().isEmpty());
        assertNull(book.summary().dialogue());
        assertEquals("test", book.summary().book());
    }

    /** A chapter as MAT writes it: just the headings and one paragraph. */
    private static String chapter(String heading, String raw) {
        return raw == null
                ? "{\"heading\": \"%s\", \"paragraphs\": [\"x\"]}".formatted(heading)
                : "{\"heading\": \"%s\", \"heading_raw\": \"%s\", \"paragraphs\": [\"x\"]}".formatted(heading, raw);
    }

    private static List<String> groups(String... chapters) {
        BookStats book = read("{\"title\": \"Test\", \"chapters\": [" + String.join(",", chapters) + "]}");
        return book.chapters().stream().map(c -> c.group() == null ? "-" : c.group()).toList();
    }

    @Test
    void chaptersSharingAHeadingInTheBookAreAGroup() {
        assertEquals(List.of("-", "Jaime", "Cersei", "Jaime", "-", "Cersei", "-"), groups(
                chapter("Prolog", "Prolog"), chapter("Jaime I", "Jaime"), chapter("Cersei I", "Cersei"),
                chapter("Jaime II", "Jaime"), chapter("Arya", "Arya"), chapter("Cersei II", " CERSEI "),
                chapter("Epilog", "Epilog")));
    }

    @Test
    void noGroupsWithoutRepeatedHeadings() {
        // MAT's own example: Chapter 1, Chapter 2, Epilogue.
        assertEquals(List.of("-", "-"), groups(chapter("Chapter 1", "Chapter 1"), chapter("Chapter 2", "Chapter 2")));
        // A heading every chapter has would make the group the whole book.
        assertEquals(List.of("-", "-", "-"), groups(chapter("Chapter I", "Chapter"), chapter("Chapter II", "Chapter"),
                chapter("Chapter III", "Chapter")));
        // No heading_raw, no group (the numbered heading alone doesn't tell).
        assertEquals(List.of("-", "-", "-"), groups(chapter("Jaime I", null), chapter("Jaime II", null),
                chapter("Prolog", null)));
    }

    @Test
    void theGroupGoesIntoTheSummary() {
        BookStats book = read("{\"title\": \"Test\", \"chapters\": [" + String.join(",",
                chapter("Prolog", "Prolog"), chapter("Jaime I", "Jaime"), chapter("Jaime II", "Jaime")) + "]}");
        assertEquals(List.of("Jaime"), book.only(List.of("c2")).summary().chapters().stream()
                .map(BookStats.ChapterNumbers::group).toList());
        assertNull(book.summary().chapters().getFirst().group());
    }

    @Test
    void aSlugIsPlainAscii() {
        assertEquals("das-lied-von-eis-und-feuer-05", BookStats.slug("Das Lied von Eis und Feuer 05"));
        assertEquals("schone-grusse", BookStats.slug("Schöne Grüße"));
        assertEquals("book", BookStats.slug("!!!"));
        assertEquals("book", BookStats.slug(null));
    }
}
