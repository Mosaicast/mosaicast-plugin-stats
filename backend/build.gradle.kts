// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

plugins {
    java
}

group = "dev.mosaicast.plugin"
version = "0.4.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    // An SDK checkout published with `./gradlew publishToMavenLocal` wins during development.
    mavenLocal()
    // The SDK is on Maven Central from 0.19.2.
    mavenCentral()
}

dependencies {
    compileOnly("dev.mosaicast:plugin-api:0.20.0")
    compileOnly("org.pf4j:pf4j:3.16.0")
    annotationProcessor("org.pf4j:pf4j:3.16.0") // generates the PF4J extension index for @Extension

    testImplementation(platform("org.junit:junit-bom:6.1.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("dev.mosaicast:plugin-testkit:0.20.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.compilerArgs.addAll(listOf("-Xlint:all,-processing", "-Werror"))
}

tasks.test {
    useJUnitPlatform()
    // Optional: ./gradlew test -PstatsSamples=/path/to/results runs every ZIP in that folder through the
    // readers (LocalResultsTest). Off by default; real results stay out of the repo.
    providers.gradleProperty("statsSamples").orNull?.let {
        systemProperty("stats.samples", it)
        outputs.upToDateWhen { false }
    }
    testLogging { showStandardStreams = providers.gradleProperty("statsSamples").isPresent }
}

tasks.jar {
    archiveFileName.set("stats.jar")
}
