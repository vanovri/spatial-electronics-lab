# Bounded spatial-migration prompt template

This is a prompt template, not evidence of an autonomous model run.

```text
Upgrade the shared synthetic 2D layout into a selectable perspective 3D view while
preserving component IDs, pins, links, and selection state. Use the documented
camera coordinate system. Keep a selectable 2D mode and keyboard-accessible controls.

Before editing, run the Kotlin, Node and Python suites and assembleDebug. Record
source hashes and retain the baseline APK. Freeze scene data, tests and build files.
Allowed implementation files: Geometry.kt, MainActivity.kt and browser view code.

After each Kotlin edit, run compileDebugKotlin. Before accepting, require
assembleDebug and testDebugUnitTest to succeed, then verify browser selection in
both modes, keyboard navigation, narrow layout and real draw-cost reporting.

Use at most five edit/check attempts and twenty minutes. No fabricated compiler
messages, simulated APK success, threshold changes, source-tree deletion, external
data uploads or public posting. Unknown build errors must remain explicit.

For the known diagnostic-repair exercise, use self_healing_gradle_loop.py. Never
modify its frozen tests or treat its trusted-code process limits as a security
sandbox. Return source hashes, real logs, APK digest, test results and limitations.
```
