# SKILLS.md

Skills available in this repository, and when each earns its keep. They live in
`.claude/skills/<name>/SKILL.md` and are loaded on demand.

| Skill | Use it when |
|---|---|
| [`verify-ui`](.claude/skills/verify-ui/SKILL.md) | A change affects the browser flasher page, the firmware gallery, hex validation, or the number of steps a student must take. Drives the real page with Playwright headless Chromium and asserts on the live DOM. |

## `verify-ui`

**What it is for.** Observing the actual page rather than reasoning about it —
a button that should be enabled, a gallery that silently fails to load, an error
message that never appears.

**What it cannot do.** WebUSB device selection. `navigator.usb.requestDevice()`
needs a real device and a user gesture in a browser-native dialog; Playwright
cannot grant it. Everything up to *"Flash becomes enabled"* is testable; the
flash itself needs a board and a human.

**Install Playwright into the session scratchpad, never the repo.** There is no
npm build here on purpose, and `node_modules/` would be 100 MB of untracked
noise.

## How this relates to the other checks

Three layers, cheapest first. Reach for the cheapest that can catch the bug.

| | Runs | Catches |
|---|---|---|
| `node tools/test_flasher.mjs` | CI, seconds | Page logic against a mocked USB connection: hex validation, connect/flash/reconnect, the gallery, page wiring |
| `node tools/test_extension.mjs` | CI, seconds | The VS Code extension: packaging, `ExtensionKind=web`, a worker-safe bundle, activation without a DOM |
| `verify-ui` (Playwright) | by hand | Real browser: layout, real DOM events, real file inputs, real module loading |

`python3 tools/mb.py build --all` and `prove --all-spark` cover the Ada side and
run in CI.

## Adding a skill

Keep them narrow and honest about limits — the most useful part of `verify-ui`
is the section saying what it *cannot* test, because that is what stops someone
concluding "the flasher is verified" when the flash itself never ran.

State the trigger in the `description`, so it is loaded when relevant and left
alone otherwise.
