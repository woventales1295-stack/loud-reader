#!/usr/bin/env python3
"""Assemble src/ parts into a single self-contained index.html (all libs inlined as base64)."""
import base64, os, sys
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "..", "src")
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "apk_build", "assets", "index.html")
rd = lambda n: open(os.path.join(src, n), encoding="utf-8").read()
b64 = lambda n: base64.b64encode(open(os.path.join(src, "new_libs", n), "rb").read()).decode()

head = rd("head_pre.html")
css = rd("css.html")
head = head + "\n" + css + "\n"
body = rd("body.html")
libs = rd("libs.html").rstrip("\n") + "\n"
libs += '<script type="text/b64" id="lib-mobi">%s</script>\n' % b64("mobi.js")
libs += '<script type="text/b64" id="lib-unrar">%s</script>\n' % b64("unrar_bundle.js")
libs += '<script type="text/b64" id="unrar-wasm">%s</script>\n' % b64("unrar.wasm")
app = rd("app.js")
assert "/*__READING_JS__*/" in app
app = app.replace("/*__READING_JS__*/", rd("reading.js") + "\n" + rd("pager.js"))
html = head + "\n" + body + "\n" + libs + app
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
open(out, "w", encoding="utf-8").write(html)
print("wrote", out, len(html), "bytes")
