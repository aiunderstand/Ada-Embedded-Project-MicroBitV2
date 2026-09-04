# Vendored dependencies

## `microbit-connection-usb.mjs`

`@microbit/microbit-connection` **1.0.0**, USB entrypoint, with its dependencies
(`nrf-intel-hex`, `@microbit/microbit-universal-hex`) inlined into one
self-contained ES module. About 48 KB.

Vendored rather than loaded from a CDN on purpose: students use this page from
school networks, and a blocked or slow third-party origin would break flashing.
There is no build step in this repository, so the bundle is committed.

Upstream: <https://github.com/microbit-foundation/microbit-connection> (MIT).

### Updating

```shell
VER=1.0.0   # set to the version you want
SHIM=$(curl -s "https://esm.sh/@microbit/microbit-connection@${VER}/usb?bundle&target=es2022")
TARGET=$(printf '%s' "$SHIM" | grep -o '"/[^"]*"' | tr -d '"')
curl -sL "https://esm.sh${TARGET}" -o /tmp/usb.bundle.mjs
```

Then re-apply the header comment at the top of the existing file, replace the
body, and check that it still exports `createUSBConnection` and has **no**
remaining `from "..."` imports:

```shell
grep -oE '(import|export)[^;]*from *"[^"]+"' docs/vendor/microbit-connection-usb.mjs
```

That command must print nothing. Then run `node tools/test_flasher.mjs`.
