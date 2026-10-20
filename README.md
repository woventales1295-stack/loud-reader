# Loud Reader v2 — source tree

```
src/            web app parts (head_pre, css, body, app.js, libs.html = v1 base64 libs) + new_libs/ (mobi.js, unrar)
tools/build_html.py   assembles src/ into one self-contained apk_build/assets/index.html (libs inlined as base64)
apk_build/      AndroidManifest.xml, res/, java (MainActivity.java), assets/ (generated)
build_apk.sh    runbook pipeline: html -> aapt -> javac -> dx -> dex check -> align -> apksigner -> verify
```

Build: `KS=/path/loudreader.keystore KS_PASS=... ./build_apk.sh` in an environment prepared per APK_BUILD_RUNBOOK.md §1.
Use the **v1 keystore** (alias `loudreaderkey`) or v2 will not install over v1.

## What v2 adds
- Formats: PDF, EPUB, DOCX (as v1) + MOBI/AZW/AZW3/PRC, FB2, TXT, Markdown, HTML, CBZ/CBR (and ZIP/RAR of images; RAR detected by signature)
- Shelf (library home screen) with nested folders: create / rename / delete, move books, sort (recent / name / progress)
- Back button routing: dialog → panel → fullscreen → folder up → reader→shelf → exit (`window.__handleBack`)
- Comics: page images shown as-is; Run OCR to get readable, highlightable text (now also returns word boxes, so OCR'd PDFs/comics keep page-image view with highlight)
- Screen stays on while reading aloud (`AndroidBridge.setKeepScreenOn`)
- Export highlights & notes (.md/.txt) and "Save text as .txt" via chunked MediaStore save to Downloads/LoudReader
- In-page dialogs replace alert/confirm/prompt (WebView doesn't reliably show those)
- No permissions requested; all libs bundled; orientation no longer locked
