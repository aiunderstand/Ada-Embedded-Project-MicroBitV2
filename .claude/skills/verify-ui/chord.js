// The chord in a real web workbench, read back through the extension's own log:
// "Asking you to choose the micro:bit" is written only by the flash command.
const { chromium } = require("playwright");
const chord = process.argv[2] || (process.platform === "darwin" ? "Meta+Shift+B" : "Control+Shift+B");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await b.newPage();
  await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.waitForSelector(".monaco-workbench", { timeout: 60000 });
  let bar = "";
  for (let i = 0; i < 40 && !/Flash micro:bit/.test(bar); i++) { await p.waitForTimeout(1000); bar = (await p.locator(".statusbar-item").allTextContents()).join(" | "); }
  console.log("activated:", /Flash micro:bit/.test(bar));
  await p.keyboard.press("Escape");
  await p.locator(".editor-group-container").first().click({ position: { x: 200, y: 200 } }).catch(() => {});
  await p.waitForTimeout(500);
  if (chord !== "none") { await p.keyboard.press(chord); await p.waitForTimeout(4000); }
  // open the micro:bit output channel through the status command
  await p.keyboard.press("F1");
  await p.waitForTimeout(800);
  await p.keyboard.type("micro:bit: Show connection status");
  await p.waitForTimeout(1200);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(3000);
  const out = await p.evaluate(() => {
    const panel = document.querySelector(".part.panel");
    const lines = panel ? panel.querySelectorAll(".view-line") : [];
    return Array.from(lines, (l) => l.textContent).join("\n");
  });
  console.log("chord pressed:", chord);
  console.log("flash command ran (asked for the board):", /Asking you to choose the micro:bit/.test(out));
  console.log("status command ran:", /--- status ---/.test(out));
  console.log("log excerpt:", JSON.stringify(out.split("\n").filter((l) => /Asking|status|host:|navigator|ready|Error/i.test(l)).slice(0, 8)));
  const toasts = await p.locator(".notifications-toasts .notification-list-item").allTextContents();
  console.log("toasts:", JSON.stringify(toasts));
  await b.close();
})().catch((e) => { console.error("chord2.js:", e.message); process.exit(1); });
