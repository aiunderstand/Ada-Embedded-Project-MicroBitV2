# Publishing the flasher extension (lecturer only)

Students install **micro:bit v2 Flasher** from the Marketplace, in the browser.
That is the only place a web extension can run in a Codespace — one installed
into the Codespace itself never starts (microsoft/vscode#144513). Publishing is
a one-time setup, then one click per release.

## One-time setup

1. **Azure DevOps token.** Sign in at <https://dev.azure.com> with the Microsoft
   account you want to own the extension (create an organisation if asked — its
   name does not matter). User settings → *Personal access tokens* → *New
   Token*: Organization **All accessible organizations**, Scopes → *Custom
   defined* → **Marketplace: Manage**. Copy the token; it is shown once.
2. **Publisher.** At <https://marketplace.visualstudio.com/manage>, signed in
   with the same account, *Create publisher* with ID **`aiunderstand`** (the
   extension is published as `aiunderstand.microbit-flasher`; the ID is in
   `extension/package.json`).
3. **Repository secret.** In this repository: Settings → Secrets and variables →
   Actions → *New repository secret*: name `VSCE_PAT`, value the token.

## Each release

Actions → **Publish the flasher extension** → *Run workflow*. It assembles the
folder with `python3 tools/mb.py extension`, packages it with `vsce`, uploads the
`.vsix` as an artifact, and publishes version `0.1.<run number>` — the Marketplace
needs each version to be higher than the last, and the run number is.

The Marketplace takes a few minutes to list a new version. Students' browsers
update the extension on their own.

## Checking it

In a Codespace opened in Chrome: Extensions view → search `micro:bit v2
Flasher` → **Install**. *Show Running Extensions* (command palette) should list
it under **web worker** with an activation time, and **Flash micro:bit** should
be in the status bar. If it shows *Activating…* forever, it was installed into
the Codespace — uninstall it there and install again from the search box.

## Why nothing else works

The Codespaces page allows connections only to an explicit list of hosts —
the Marketplace CDNs (`*.vscode-unpkg.net`, `*.gallerycdn.vsassets.io`) among
them, GitHub Pages not. So the extension cannot be served from this repository's
site, and `Developer: Install Extension from Location…` is blocked there. And an
extension installed *into* the Codespace never starts in the browser
(microsoft/vscode#144513). The Marketplace is the one channel left.
