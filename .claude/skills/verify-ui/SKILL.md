---
name: verify-ui
description: Verify the micro:bit flasher UI by driving the real page with Playwright headless Chromium — the browser flasher in docs/, and the VS Code web extension's user flow. Use when a change affects the flasher page, the firmware gallery, hex validation, or the number of steps a student must take. Not for build/toolchain work (use tools/mb.py) or for anything needing a real board — WebUSB device selection cannot be automated.
---

# Verify the flasher UI with Playwright

Drive the actual page and assert on the live DOM, rather than reasoning about it.
This is how UI regressions get found for real — a disabled button that should be
enabled, a gallery that silently fails to load, an error message that never
appears.

## 1. Install Playwright (once per machine, in a scratch dir)

```bash
SP=<scratch dir>            # the session scratchpad, NOT the repo
cd "$SP" && npm init -y >/dev/null
npm install playwright && npx playwright install chromium
```

Never install it into the repo: there is no npm build here on purpose, and
`node_modules/` would be 100 MB of untracked noise.

## 2. Serve the page

The page is static, so any server works. Use the project's own, which also
stages the firmware the way a Codespace does:

```bash
python3 tools/mb.py build            # produces build/main.hex
python3 -u tools/mb.py serve --no-build --port 8099 &
```

`mb.py serve` assembles `build/site` = `docs/` + `firmware/` + a manifest. To
test the *published* page instead, point Playwright at
`https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/`.

## 3. Drive it

```js
const { chromium } = require('playwright');
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', m => console.log('  [console]', m.text()));
p.on('pageerror', e => console.log('  [pageerror]', e.message));
await p.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
```

Useful assertions:

- `await p.locator('#flash').isDisabled()` — Flash must stay disabled until a
  valid hex is chosen.
- `await p.locator('#examples optgroup').allTextContents()` — the gallery groups.
- `await p.setInputFiles('#file', path)` — exercises hex validation without a board.
- `await p.locator('#firmware').textContent()` — the accept/reject message.

## 4. What cannot be tested this way

**WebUSB device selection.** `navigator.usb.requestDevice()` needs a real device
and a user gesture in a browser-native permission dialog; Playwright cannot grant
it and Chromium headless has no device. So:

- Everything up to and including "Flash becomes enabled" is testable here.
- The flash itself needs a board and a human.

`navigator.usb` is *absent* in headless Chromium, so the page takes its
unsupported-browser path. Launch with `chromium.launch({ channel: 'chrome' })`
against real Chrome if you need `navigator.usb` to exist, and stub
`navigator.usb.getDevices` with `page.addInitScript` to exercise the connected
paths.

## 5. The VS Code extension, in a real extension host

`tools/test_extension.mjs` loads the bundle into a mock `vscode` object. That
catches packaging mistakes, not whether the extension activates in the real web
worker host or whether its chord resolves. For those, run VS Code for the Web
itself, with the packaged extension loaded:

```bash
cd "$SP" && npm install @vscode/test-web
python3 tools/mb.py extension                      # build/microbit-flasher-*.vsix
rm -rf "$SP/vsix" && mkdir "$SP/vsix" && (cd "$SP/vsix" && unzip -q <repo>/build/microbit-flasher-*.vsix)
npx @vscode/test-web --browser none --quality stable --port 3000 \
    --extensionDevelopmentPath "$SP/vsix/extension" <a small folder with .vscode/tasks.json and build/main.hex>
```

`--browser none` only starts the server; drive it with your own Playwright:
wait for `.monaco-workbench`, give `onStartupFinished` ~15 s, then

- `.statusbar-item` texts should include **Flash micro:bit** — activation proof;
- `page.keyboard.press('Control+Alt+F')` then read
  `.notifications-toasts .notification-list-item`: with no board the correct
  result is *Failed to execute 'requestDevice' on 'USB': No device selected*,
  which proves the chord reached the command and the command reached WebUSB;
- *command 'microbit.flash' not found* means the manifest loaded and the code
  did not.

**Is a chord already taken?** Run `Preferences: Open Default Keyboard Shortcuts
(JSON)` in that instance, select all, copy, and read the clipboard from the page
(grant `clipboard-read`). VS Code spells modifiers in the order ctrl, shift,
alt, cmd — `alt+cmd+f`, never `cmd+alt+f`. The platform follows the user agent,
so a `newContext({ userAgent })` spoofing Windows or Linux yields those tables
from the same server. Chromium headless on macOS reports the Mac tables.

What test-web cannot do is a *remote* — and a Codespace is a remote. Two bugs
lived only there: `vscode.tasks.executeTask` throwing `NotSupported` in the web
worker host (test-web has no tasks to fetch, so the build was silently skipped),
and the same-version reinstall on attach leaving a half-updated window. For
those, run VS Code's own server:

```bash
CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
mkdir -p "$SP/serve-web-data/data/User" && echo '{ "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none" }' > "$SP/serve-web-data/data/User/settings.json"
"$CODE" serve-web --without-connection-token --accept-server-license-terms --port 8100 \
    --server-data-dir "$SP/serve-web-data" --cli-data-dir "$SP/cli-data" --default-folder <repo>
```

The browser at `http://localhost:8100/` is the client, the server is the remote,
and the extension runs in the browser's web worker host exactly as in a
Codespace. Install the way `postAttachCommand` does — by typing into the
**integrated terminal**, where `code` is the remote CLI with the IPC hook, so
the running window sees the install happen:

- open a terminal via the palette (`Terminal: Create New Terminal`; the backtick
  chord does not survive headless key mapping), wait, send one throwaway Enter
  — the first terminal eats the first keystrokes — then type
  `code --install-extension build/microbit-flasher-0.1.0.vsix --force > $SP/t.log 2>&1`
  and read the log from disk rather than scraping xterm rows;
- the server's extensions live in `$SP/serve-web-data/extensions`; pass
  `VSCODE_EXTENSIONS=` there when exercising `mb.py extension --install` so its
  installed-copy check can find them;
- `Developer: Reload Window` from the palette is a clean re-attach.

Then the same assertions as above: the status-bar item is activation, the
notification after the chord is the command running. With no board, a fully
working flow ends in a USB error *after* the build has run — check
`build/main.hex`'s mtime moved.

**Check the cache headers when code seems stale:**
`curl -sI 'http://localhost:8100/vscode-remote-resource?path=<extensions>/<dir>/extension.js'`
shows `cache-control: public, max-age=31536000`. A same-version reinstall keeps
the URL, so a reload can run old code under a new manifest; that is why the
packaged version is content-derived, and why a test here should install a
*changed* build and confirm the new code runs after the reload (a marker line
in the output channel is enough).

## 6. Counting the steps

To judge whether a flow is too cumbersome, count what a student actually does —
clicks, keystrokes, and dialogs — rather than guessing. Record them, then compare
against the alternative before changing anything.

## Related

`tools/test_flasher.mjs` unit-tests the same page logic headlessly with a mocked
connection, and runs in CI. Playwright is for the things that need a real
browser: layout, real DOM events, real file inputs, real module loading.
