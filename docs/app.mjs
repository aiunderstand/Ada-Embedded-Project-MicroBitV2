/**
 * micro:bit v2 flasher + serial console.
 *
 * One WebUSB connection does both. That works because WebUSB talks to the
 * board's interface chip (DAPLink), which is separate from the nRF52833 running
 * your program: flashing does not drop the connection, and serial output
 * resumes automatically afterwards.
 *
 * createApp() takes its dependencies as arguments so the whole thing can be
 * driven headlessly by tools/test_flasher.mjs.
 */

/** Largest amount of serial text kept in the DOM. */
const MAX_CHARS = 200_000;

/**
 * Check that a file really is Intel HEX before we try to flash it.
 *
 * Students most often pick the wrong artifact -- `main` is an ELF, and DAPLink
 * would reject it -- so say so here rather than failing mid-flash.
 */
export function validateHex(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return "the file is empty";
  if (!lines[0].startsWith(":")) {
    return "this is not an Intel HEX file (it does not start with ':'). " +
           "If you downloaded the CI artifact, use main.hex, not main (which is an ELF).";
  }
  const bad = lines.findIndex((l) => !/^:[0-9A-Fa-f]{8,}$/.test(l));
  if (bad !== -1) return `line ${bad + 1} is not a valid Intel HEX record`;
  if (lines[lines.length - 1].toUpperCase() !== ":00000001FF") {
    return "the file is truncated (no end-of-file record). Try downloading it again.";
  }
  return null;
}

export function createApp({
  createUSBConnection,
  doc = globalThis.document,
  raf = globalThis.requestAnimationFrame,
  usbSupported = typeof globalThis.navigator !== "undefined" && !!globalThis.navigator.usb,
  fetchFn = globalThis.fetch?.bind(globalThis),
}) {
  const $ = (id) => doc.getElementById(id);
  const els = {
    connect: $("connect"), disconnect: $("disconnect"), status: $("status"),
    file: $("file"), drop: $("drop"), firmware: $("firmware"),
    flash: $("flash"), bar: $("bar"), phase: $("phase"),
    out: $("out"), clear: $("clear"), unsupported: $("unsupported"),
    gallery: $("gallery"), examples: $("examples"),
  };

  // ---- serial output, buffered ------------------------------------------
  // Appending to textContent on every chunk is O(n^2) and locks the tab for a
  // program printing in a loop, which is exactly what the examples do.
  let buffer = "";
  let painting = false;
  const paint = () => {
    if (painting) return;
    painting = true;
    raf(() => {
      painting = false;
      const stuck = els.out.scrollTop + els.out.clientHeight >= els.out.scrollHeight - 24;
      els.out.textContent = buffer;
      if (stuck) els.out.scrollTop = els.out.scrollHeight;
    });
  };
  const append = (text) => {
    buffer += text;
    if (buffer.length > MAX_CHARS) buffer = buffer.slice(-MAX_CHARS);
    paint();
  };
  const note = (text) => append(`[${text}]\n`);

  if (!usbSupported) {
    if (els.unsupported) els.unsupported.hidden = false;
    els.connect.disabled = true;
    els.status.textContent = "unsupported browser";
    return { append, validateHex };
  }

  const usb = createUSBConnection();
  let hex = null;      // { name, text }
  let connected = false;
  let flashing = false;

  const setStatus = (t) => { els.status.textContent = t; };
  const refresh = () => {
    els.connect.disabled = connected || flashing;
    els.disconnect.disabled = !connected || flashing;
    els.flash.disabled = !connected || !hex || flashing;
    els.file.disabled = flashing;
  };

  usb.addEventListener("status", ({ status }) => {
    connected = status === "Connected";
    setStatus(status === "Connected" ? "connected"
            : status === "Paused" ? "paused (tab hidden)"
            : "not connected");
    refresh();
  });
  usb.addEventListener("serialdata", ({ data }) => append(data));
  // Fired when the running program changes, so old output is stale.
  usb.addEventListener("serialreset", () => { buffer = ""; els.out.textContent = ""; });
  usb.addEventListener("backgrounderror", ({ error }) => note(`connection error: ${error.message}`));

  // ---- firmware selection ------------------------------------------------
  async function useFile(file) {
    if (!file) return;
    const text = await file.text();
    const problem = validateHex(text);
    if (problem) {
      hex = null;
      els.firmware.textContent = `${file.name} - rejected: ${problem}`;
      note(`cannot use ${file.name}: ${problem}`);
    } else {
      hex = { name: file.name, text };
      const kb = Math.round(file.size / 1024);
      els.firmware.textContent = `${file.name} (${kb} KB)`;
      note(`loaded ${file.name}`);
    }
    refresh();
  }

  els.file.addEventListener("change", (e) => useFile(e.target.files?.[0]));
  if (els.drop) {
    for (const ev of ["dragenter", "dragover"]) {
      els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList?.add("over"); });
    }
    for (const ev of ["dragleave", "drop"]) {
      els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList?.remove("over"); });
    }
    els.drop.addEventListener("drop", (e) => useFile(e.dataTransfer?.files?.[0]));
  }

  // ---- ready-built examples ---------------------------------------------
  // CI builds every project and publishes the hex files next to this page, so a
  // student can flash something that works before writing any code. The
  // manifest is absent when the site is served without that step (a fork with
  // Pages off, or local preview), in which case the section simply stays hidden.
  async function loadGallery() {
    if (!els.gallery || !els.examples || !fetchFn) return;
    let manifest;
    try {
      const res = await fetchFn("./firmware/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(String(res.status));
      manifest = await res.json();
    } catch {
      els.gallery.hidden = true;
      return;
    }
    const families = [
      // "build" only appears when the page is served from a Codespace or a
      // local machine by "mb.py serve", where the firmware you just built sits
      // next to the page. It goes first because it is what you came for.
      ["build", "Your latest build"],
      ["template", "Template"],
      ["spark", "SPARK (proved)"],
      ["ravenscar", "Ravenscar"],
      ["zfp", "Light / ZFP"],
    ];
    for (const [family, label] of families) {
      const inFamily = (manifest.projects ?? []).filter((p) => p.family === family);
      if (inFamily.length === 0) continue;
      const group = doc.createElement("optgroup");
      group.label = label;
      for (const proj of inFamily) {
        const opt = doc.createElement("option");
        opt.value = proj.hex;
        opt.dataset.id = proj.id;
        opt.textContent = proj.summary ? `${proj.label} - ${proj.summary}` : proj.label;
        group.appendChild(opt);
      }
      els.examples.appendChild(group);
    }
    els.gallery.hidden = false;
  }

  async function useExample(hexName, id) {
    if (!hexName || !fetchFn) return;
    try {
      const res = await fetchFn(`./firmware/${hexName}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const problem = validateHex(text);
      if (problem) throw new Error(problem);
      hex = { name: `${id} (ready-built)`, text };
      els.firmware.textContent = `${id} - ${Math.round(text.length / 1024)} KB, ready-built`;
      note(`loaded ${id}`);
    } catch (err) {
      hex = null;
      els.firmware.textContent = `could not load ${id}: ${err.message}`;
      note(`could not load ${id}: ${err.message}`);
    }
    refresh();
  }

  if (els.examples) {
    els.examples.addEventListener("change", (e) => {
      const sel = e.target;
      const opt = sel.options?.[sel.selectedIndex];
      if (opt?.value) useExample(opt.value, opt.dataset?.id ?? opt.value);
    });
  }

  // ---- actions -----------------------------------------------------------
  els.connect.addEventListener("click", async () => {
    setStatus("connecting...");
    try {
      await usb.connect();
    } catch (err) {
      setStatus("connection failed");
      note(err?.name === "NoDeviceSelected" || /cancel|no device/i.test(err?.message ?? "")
        ? "no board selected"
        : `could not connect: ${err.message}`);
      refresh();
    }
  });

  els.disconnect.addEventListener("click", async () => {
    try { await usb.disconnect(); } catch (err) { note(`disconnect failed: ${err.message}`); }
  });

  const setProgress = (fraction, label) => {
    els.phase.textContent = label;
    if (fraction === null || fraction === undefined) {
      els.bar.removeAttribute("value");        // indeterminate
    } else {
      els.bar.value = Math.round(fraction * 100);
    }
  };

  els.flash.addEventListener("click", async () => {
    if (!hex) return;
    flashing = true;
    refresh();
    els.bar.hidden = false;
    setProgress(0, "starting");
    try {
      await usb.flash(async () => hex.text, {
        // Partial flashing is a MakeCode feature: it relies on that toolchain's
        // flash layout. A GNAT-built hex must always be flashed in full.
        partial: false,
        progress: (stage, fraction) => setProgress(fraction ?? null, String(stage)),
      });
      setProgress(1, "done");
      note(`flashed ${hex.name}`);
    } catch (err) {
      setProgress(null, "failed");
      note(`flash failed: ${err.message}`);
    } finally {
      flashing = false;
      refresh();
      setTimeout(() => { els.bar.hidden = true; els.phase.textContent = ""; }, 1500);
    }
  });

  els.clear.addEventListener("click", () => { buffer = ""; els.out.textContent = ""; });

  refresh();
  loadGallery();
  return { usb, append, validateHex, useFile, useExample, loadGallery,
           get hex() { return hex; } };
}
