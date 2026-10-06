// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.ingest;

import dev.mosaicast.plugin.api.DocStore;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.stats.ingest.Docs.Bundle;
import dev.mosaicast.plugin.stats.ingest.Docs.BundleSettings;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;

/**
 * The site's bundles, read from the {@code bundles} document. That document is written by podcasters on the
 * manage page, so everything in it is checked here; anything unusable is ignored. A kind nobody configured
 * gets one implicit bundle whose id is the kind itself, which is also where stats from before bundles go.
 */
final class Bundles {

    static final List<String> KINDS = List.of("podcast", "book");
    private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]{0,39}");

    private final List<Bundle> list;

    private Bundles(List<Bundle> list) {
        this.list = list;
    }

    static Bundles load(DocStore store) {
        List<Bundle> out = new ArrayList<>();
        Optional<JsonNode> doc = store.get(Scope.site(), Docs.BUNDLES, JsonNode.class);
        if (doc.isPresent()) {
            try {
                BundleSettings settings = Json.read(doc.get(), BundleSettings.class);
                for (Bundle b : settings.bundles() == null ? List.<Bundle>of() : settings.bundles()) {
                    if (b != null && b.id() != null && ID.matcher(b.id()).matches() && KINDS.contains(b.kind())
                            && out.stream().noneMatch(o -> o.id().equals(b.id()))) {
                        out.add(b);
                    }
                }
            } catch (JacksonException e) {
                // A broken settings document means "defaults", not "no stats".
            }
        }
        for (String kind : KINDS) {
            if (out.stream().noneMatch(b -> b.kind().equals(kind)) && out.stream().noneMatch(b -> b.id().equals(kind))) {
                out.add(new Bundle(kind, kind, null, false, null));
            }
        }
        return new Bundles(List.copyOf(out));
    }

    /** The bundle with this id, if it exists and is of this kind. */
    Optional<Bundle> find(String id, String kind) {
        return list.stream().filter(b -> b.id().equals(id) && b.kind().equals(kind)).findFirst();
    }

    /** The bundle a kind falls back to: its first one without spoilers, else its first one. */
    Bundle defaultFor(String kind) {
        return list.stream().filter(b -> b.kind().equals(kind) && !Boolean.TRUE.equals(b.spoiler())).findFirst()
                .or(() -> list.stream().filter(b -> b.kind().equals(kind)).findFirst())
                .orElse(new Bundle(kind, kind, null, false, null));
    }

    /** The bundle whose file-name rule matches the text, else the kind's default. */
    Bundle suggest(String kind, String... texts) {
        for (Bundle b : list) {
            if (!b.kind().equals(kind) || b.match() == null || b.match().isBlank()) {
                continue;
            }
            String rule = b.match().toLowerCase(Locale.ROOT).strip();
            for (String text : texts) {
                if (text != null && text.toLowerCase(Locale.ROOT).contains(rule)) {
                    return b;
                }
            }
        }
        return defaultFor(kind);
    }

    /** The text without a matched rule, so "SPOILER! 5.22 - Arya IV" matches the episode "5.22 - Arya IV". */
    static String withoutRule(String text, Bundle bundle) {
        if (text == null || bundle.match() == null || bundle.match().isBlank()) {
            return text;
        }
        return Pattern.compile(Pattern.quote(bundle.match().strip()), Pattern.CASE_INSENSITIVE).matcher(text)
                .replaceAll(" ").strip();
    }
}
