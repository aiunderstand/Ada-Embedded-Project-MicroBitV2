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
worker host or whether its chord resolves. Two rigs, both in the scratchpad:

**test-web — no remote, fastest.** Loads the assembled folder as a development
extension, straight into the web worker host.

```bash
cd "$SP" && npm install @vscode/test-web
python3 tools/mb.py extension --out "$SP/ext"
npx @vscode/test-web --browser none --quality stable --port 3000 \
    --extensionDevelopmentPath "$SP/ext" <a small folder with .vscode/tasks.json and build/main.hex>
```

**serve-web — a real VS Code Server as the remote, the way a Codespace is.**
It has no development-extension option, so install into the server with the
remote CLI from the integrated terminal (`code --install-extension`) — knowing
that this delivery does *not* work in a Codespace (#144513); here the worker is
same-origin, so it does, and it is the only way to get the extension into this
rig. Do not try *Install Extension from Location* with `mb.py serve`: the page
policy is `connect-src … https:`, and `http://localhost` is refused.

```bash
CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
mkdir -p "$SP/serve-web-data/data/User" && echo '{ "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none" }' > "$SP/serve-web-data/data/User/settings.json"
"$CODE" serve-web --without-connection-token --accept-server-license-terms --port 8100 \
    --server-data-dir "$SP/serve-web-data" --cli-data-dir "$SP/cli-data" --default-folder <repo>
```

Drive either with your own Playwright: wait for `.monaco-workbench`, allow
`onStartupFinished` ~15 s, then

- `.statusbar-item` texts should include **Flash micro:bit** — activation proof;
- `page.keyboard.press('Control+Alt+F')` then read
  `.notifications-toasts .notification-list-item`: with no board the correct
  result is *Failed to execute 'requestDevice' on 'USB': No device selected*,
  reached *after* the Build task ran (check `build/main.hex`'s mtime moved) —
  the chord reached the command, the build ran, the command reached WebUSB;
- *command 'microbit.flash' not found* means the manifest loaded and the code
  did not; the **Extension Host (Worker)** output channel says why.

In the serve-web terminal, the first keystrokes of a fresh terminal are eaten
while the shell starts — send a throwaway Enter, wait, then type — and read
command output from a file you redirected to, not from xterm rows.

**Is a chord already taken?** Run `Preferences: Open Default Keyboard Shortcuts
(JSON)` in the instance, select all, copy, and read the clipboard from the page
(grant `clipboard-read`). VS Code spells modifiers in the order ctrl, shift,
alt, cmd — `alt+cmd+f`, never `cmd+alt+f`. The platform follows the user agent,
so a `newContext({ userAgent })` spoofing Windows or Linux yields those tables
from the same server.

What neither rig can show: a Codespace's routing and content-security policy.
That needs a Codespace and the published extension, and the diagnostic order
that works there is *Show Running Extensions* → the **Extension Host (Worker)**
channel → the Network tab filtered on `extension.js` → the Console for
`Content Security Policy`.

## 6. Counting the steps

To judge whether a flow is too cumbersome, count what a student actually does —
clicks, keystrokes, and dialogs — rather than guessing. Record them, then compare
against the alternative before changing anything.

## Related

`tools/test_flasher.mjs` unit-tests the same page logic headlessly with a mocked
connection, and runs in CI. Playwright is for the things that need a real
browser: layout, real DOM events, real file inputs, real module loading.
