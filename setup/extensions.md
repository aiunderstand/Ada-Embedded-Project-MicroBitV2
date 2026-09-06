# Building, testing and publishing the extensions (maintainers)

Students never build these — they install **micro:bit v2 Flasher**
(`AIUnderstand.microbit-flasher`) from the Marketplace, in the browser. This
page is for the lecturer who maintains that extension and its companion.

## The two extensions, and why there are two

| | Runs in | Job |
|---|---|---|
| **`extension/`** → `AIUnderstand.microbit-flasher` | the **browser** (web-worker extension host) | flashes over WebUSB, the serial console, and answers gdb for F5 |
| **`companion/`** → `AIUnderstand.microbit-companion` | the **Codespace container** (Node host) | installs the flasher into the browser, and relays gdb to it for F5 |

A web extension can only run in a Codespace if it is installed **in the browser
from the Marketplace** — one installed into the Codespace itself never starts
(microsoft/vscode#144513). Nothing in a repository can put an extension into a
browser except an extension already running that asks the workbench to; that is
the companion's first job. Its second is F5: it opens a local gdb port in the
container and forwards each packet to the flasher, which drives the board over
the WebUSB connection it already holds. See `extension/README.md` and
`companion/README.md` for the architecture.

The source lives in `extension/` and `companion/`. `tools/mb.py` assembles each
into a publishable folder — for the flasher it bundles the vendored
`@microbit/microbit-connection` library and `extension/gdbserver.js` ahead of
`extension/extension.js` into one classic worker script.

## Build (assemble the folder)

```shell
python3 tools/mb.py extension --out build/extension
python3 tools/mb.py companion --out build/companion
```

Each writes a self-contained folder — `package.json`, the (bundled)
`extension.js`, `README.md`, `LICENSE` — ready for `vsce`. `build/` is generated
and git-ignored, so a `git pull` never updates it; re-run these after changing
the source or the version. Pass `--version X.Y.Z` to override the version for a
one-off build (the CI publish uses this).

## Test

No build step and no `node_modules` are committed on purpose; the tests use only
Node built-ins.

```shell
node tools/test_flasher.mjs       # the browser flasher page (docs/)
node tools/test_extension.mjs     # the web extension: manifest, bundle, activation, companion
node tools/test_gdbserver.mjs     # the GDB server, against a fake board
node tools/test_companion.mjs     # the companion's gdb relay, over a real socket
```

`ada.yml` runs all four on every push, and packages both folders with `vsce` so
a release can only ever fail on credentials, not on the manifest. When you add a
test, **prove it can fail**: break the thing it guards, watch it go red, restore.

What the tests do **not** cover is the real browser↔Codespace path — WebUSB
device selection needs a human and a board. The `verify-ui` recipe (a `code
serve-web` instance driven with Playwright) exercises everything up to the USB
picker; the flash and the full F5 flow need a real Codespace with the published
extensions and a board in hand. Confirm those by hand before announcing a
release.

## Package

```shell
cd build/extension && npx @vscode/vsce package --no-dependencies
cd build/companion && npx @vscode/vsce package --no-dependencies
```

Each produces a `.vsix`. Bump `version` in `extension/package.json` (or
`companion/package.json`) **before** assembling — these are the hand-made
`0.1.x` releases, and the Marketplace refuses a version it has already seen.

## Publish

### One-time setup

1. **Azure DevOps token.** Sign in at <https://dev.azure.com> with the Microsoft
   account that will own the extension (create an organisation if asked — its
   name does not matter). User settings → *Personal access tokens* → *New
   Token*: Organization **All accessible organizations**, Scopes → *Custom
   defined* → **Marketplace: Manage**. Copy the token; it is shown once.
2. **Publisher.** At <https://marketplace.visualstudio.com/manage>, signed in
   with the same account, *Create publisher* with ID **`AIUnderstand`** (the
   extensions publish as `AIUnderstand.microbit-*`; the ID is in each
   `package.json`).
3. **Repository secret.** In this repository: Settings → Secrets and variables →
   Actions → *New repository secret*: name `VSCE_PAT`, value the token.

### Each release

Publish **both** when either changes (the companion changes rarely). Either:

- **By hand.** Build and package as above, then upload each `.vsix` at
  <https://marketplace.visualstudio.com/manage> — or `npx @vscode/vsce publish
  --packagePath build/microbit-flasher-<version>.vsix` with the token in
  `VSCE_PAT`. These are the `0.1.x` releases.
- **By workflow.** Actions → **Publish the flasher extension** → *Run workflow*.
  It assembles the folder, packages it with `vsce`, uploads the `.vsix` as an
  artifact, and publishes `0.2.<run number>`. The run number is monotonic, so
  `0.2.x` can never collide with a hand-made `0.1.x`.

The Marketplace takes a few minutes to list a new version; students' browsers
update the extension on their own.

## Check it

In a Codespace opened in Chrome: Extensions view → search **micro:bit v2
Flasher** → **Install**. *Show Running Extensions* (command palette) should list
it under **web worker** with an activation time, and **Flash micro:bit** should
be in the status bar. If it shows *Activating…* forever, it was installed into
the Codespace — uninstall it there and install again from the search box. Then
plug in a board, **Ctrl+Alt+F** to flash, and F5 to check debugging end to end.

## Why nothing else delivers it

The Codespaces page allows connections only to an explicit list of hosts — the
Marketplace CDNs (`*.vscode-unpkg.net`, `*.gallerycdn.vsassets.io`) among them,
GitHub Pages not. So the extension cannot be served from this repository's site,
and *Developer: Install Extension from Location…* is blocked there. And an
extension installed *into* the Codespace never starts in the browser
(microsoft/vscode#144513). The Marketplace is the one channel left.
