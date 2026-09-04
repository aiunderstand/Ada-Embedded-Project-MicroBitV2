# Path 🟡 — code runs in the cloud, editor runs on your machine

Same as the [browser path](codespace-browser.md), but you use the real VS Code
application instead of the browser tab. Nicer editor, your own keybindings and
themes; the code still builds on a machine in a data centre.

Choose this if you like a proper editor but cannot, or do not want to, install
the Ada toolchain locally.

---

## 1. Install two things

| | Where |
|---|---|
| **VS Code** | <https://code.visualstudio.com/download> |
| **GitHub Codespaces** extension | search `GitHub Codespaces` in the Extensions panel |

You need a **Chrome, Edge or Opera** browser as well, for flashing — but only
for that one step.

## 2. Sign in and open your Codespace

1. Press **Ctrl+Shift+P** (**Cmd+Shift+P** on a Mac).
2. Run **Codespaces: Sign In** and follow the browser prompt.
3. Press **Ctrl+Shift+P** again and run **Codespaces: Create New Codespace**.
4. Pick **your** repository, the `main` branch, and the smallest machine type
   offered — this project does not need a big one.

VS Code connects. The first start takes a couple of minutes while it prepares
the toolchain; you pay that once per Codespace. The bottom-left corner shows the
Codespace name while you are connected.

Next time, **Codespaces: Connect to Codespace** reopens it as you left it.

## 3. Work exactly as in the browser

Everything from here is identical to the browser path:

* Edit **`Code/src/main.adb`**.
* **Ctrl+Shift+B** to build; the firmware lands at `build/main.hex`.
* Commit with the **Source Control** panel, then **Sync Changes**.

## 4. Flash the board, straight from the Codespace

You do not need to download anything.

> A Codespace runs in a data centre and has **no USB port**, so it cannot reach
> your board itself. What it *can* do is serve the flasher page to your own
> browser, which then talks to the board for it.

1. Press **Ctrl+Shift+P**, choose **Tasks: Run Task**, then
   **Flash from here (serve flasher)**.
2. VS Code shows a notification that port **8080** is available. Open the
   **PORTS** panel at the bottom, find *micro:bit flasher*, and click the
   **globe** icon to open it in your browser.
3. Plug the micro:bit in with a **data** USB cable — some cables only carry power.
4. Click **Connect**, pick the board, then **Flash**.

Your build is already selected under **Your latest build** — the page is being
served from the same Codespace that produced it.

`Put_Line` output appears in the **Output** panel of that page.

> It must be a real browser tab. VS Code's built-in **Simple Browser** is an
> iframe, and WebUSB does not work inside one. Use the globe icon, which opens a
> proper tab.

Rebuild, then just click **Flash** again — the page always serves the current
`build/main.hex`.

### If you would rather not run a server

Right-click **`build/main.hex`** in the Explorer, choose **Download**, and drop
it onto <https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/>.
That page also has ready-built examples if you just want to check your board and
cable work.

---

## Good to know

**Stop the Codespace when you finish**, or it keeps consuming your free monthly
hours: <https://github.com/codespaces> → **…** → **Stop codespace**.

**F5 debugging does not work here.** Breakpoints need a real USB connection to
the board, which the remote machine does not have. If you want that, use the
[local install](local.md).

**Moving to a local install later** changes nothing about your code — commit,
then clone your repository and follow the [local guide](local.md).

## Troubleshooting

**"Codespaces: Sign In" does nothing.** Make sure you are signed in to GitHub in
your browser first, then try again.

**The connection drops.** Reconnect with **Codespaces: Connect to Codespace**.
Anything you committed is safe; uncommitted edits are usually still there, which
is why you should commit often.

**Ctrl+Shift+B does nothing.** Accept the "Do you trust the authors" prompt —
Restricted Mode disables the build tasks.
