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

## 4. Flash the board

> Your terminal, your build and your files are all on the remote machine, which
> has **no USB port**. Plugging the board into your own laptop does not make it
> visible to the Codespace — even though the editor looks local.

1. In the Explorer, right-click **`build/main.hex`** and choose **Download**.
2. Open <https://aiunderstand.github.io/Ada-Embedded-Project-MicroBitV2/> in
   Chrome, Edge or Opera.
3. **Connect**, drop the file in, **Flash**.

Serial output appears in the **Output** panel on that page.

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
