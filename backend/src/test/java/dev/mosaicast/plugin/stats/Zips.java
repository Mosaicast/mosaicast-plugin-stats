// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Builds ZIP archives in memory for tests. */
public final class Zips {

    private Zips() {
    }

    public static byte[] zip(Map<String, byte[]> entries) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (Map.Entry<String, byte[]> e : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(e.getKey()));
                zip.write(e.getValue());
                zip.closeEntry();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    public static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    /** The files of MAT's own podcast example (format 2.6.0), as archive entries. */
    public static Map<String, byte[]> matExample() {
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (String name : new String[] {"meta.json", "podcast/result.json", "podcast/transcript.txt",
                "podcast/diarization.rttm"}) {
            files.put(name, resource("/mat-example/" + name));
        }
        return files;
    }

    /** The files of MAT's own book example (format 2.6.0), as archive entries. */
    public static Map<String, byte[]> matBookExample() {
        Map<String, byte[]> files = new LinkedHashMap<>();
        files.put("meta.json", resource("/mat-example-book/meta.json"));
        files.put("book/result.json", resource("/mat-example-book/book/result.json"));
        return files;
    }

    public static byte[] resource(String path) {
        try (InputStream in = Zips.class.getResourceAsStream(path)) {
            if (in == null) {
                throw new IllegalStateException("missing test resource " + path);
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
