# Recorded local checks, 19 October 2026

The Android app assembled successfully under WSL Ubuntu 26.04 using OpenJDK 17,
Gradle 8.9, Android SDK 35, and the pinned Kotlin/Compose configuration. The initial
build completed 41 tasks in 4 minutes 25 seconds, including all 10 Kotlin tests.
All 6 Node spatial tests and 3 Python diagnostic/repair tests also passed.

The actual debug APK is 8,740,472 bytes. Its local SHA256 is
`85f7ccae623e8ff8a58f52df0dbae3d7dedbce77011771736e658cbe44a5061e`.
ZIP integrity and the embedded `assets/lab.json` were verified against the shared
scene source. The APK contains compiled DEX code and resources.

The compiler-repair exercise ran on a copy with two injected defects. Attempt 1
failed with real Kotlin diagnostics. Only the allowlisted angle conversion and
gesture import were patched. Attempt 2 produced an APK and passed
`testDebugUnitTest`. Original source hashes remained unchanged. The repair-copy
APK SHA256 is `371d68f58378e93d7843c3fd872cdb6fd23c59c48b359701307392df7f6c5f6b`.
See [repair report](../reports/repair.json) and the two retained Gradle logs.

Browser QA verified selection persistence across 3D/2D, component selection with
keyboard Enter, no console errors, and no page-level horizontal overflow at a
375 CSS-pixel viewport. A 60-draw sweep at a 970.4 by 430 CSS-pixel Canvas measured
median 0.500 ms and maximum 11.200 ms of synchronous drawing-code time in the
tested Brave session, at device pixel ratio 1.25. This excludes GPU completion and
does not establish physical-device FPS. Screenshots show the browser companion.

Remote CI produces fresh APK and test/repair artifacts for its own toolchain.
Consult the Actions result for current status. No Android device/emulator runtime
claim is made by these local build and geometry results.
