package com.devise.loudreader.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private static final int FILECHOOSER_RESULTCODE = 51;
    private static final int FOLDER_PICK_RESULTCODE = 52;
    private static final int MAX_IMPORT_FILES = 4000; // sane bound on a single folder-import walk
    // Literal value of TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED (compile
    // classpath is the API 23 stub; the OS resolves strings at runtime anyway).
    private static final String FEATURE_NOT_INSTALLED = "notInstalled";
    // MediaStore column names as literals for the same reason (rule: the
    // API 23 stub predates MediaStore.Downloads).
    private static final String COL_DISPLAY_NAME = "_display_name";
    private static final String COL_MIME_TYPE = "mime_type";
    private static final String COL_IS_PENDING = "is_pending";
    private static final String COL_RELATIVE_PATH = "relative_path";
    private static final Uri DOWNLOADS_COLLECTION = Uri.parse("content://media/external/downloads");

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;

    // State of an in-progress chunked save (see FileBridge).
    private OutputStream saveOut;
    private Uri saveUri;

    // Folder-import state (see FileBridge#pickFolder / #readImportChunk).
    // importEntries maps a synthetic per-file id (assigned while walking the
    // picked folder tree) to that file's content Uri, so the page can request
    // bytes for one specific entry after it receives the manifest.
    private final Map<String, Uri> importEntries = new HashMap<>();
    // A single-slot "currently open" read stream: the page always reads one
    // entry start-to-finish (sequential, increasing offsets) before moving to
    // the next, same access pattern as FileBridge's chunked save in reverse,
    // so one open stream is enough -- no need for true random-access seeking.
    private String curImportId;
    private InputStream curImportStream;
    private long curImportPos;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        WebView.setWebContentsDebuggingEnabled(false);

        webView = new WebView(this);
        webView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSaveFormData(false);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail detail) {
                // the web renderer died (usually out of memory): don't take the whole app down, rebuild the screen
                try { Toast.makeText(MainActivity.this, "Reader restarted (low memory)", Toast.LENGTH_LONG).show(); } catch (Exception e) { }
                try { if (v != null) v.destroy(); } catch (Exception e) { }
                webView = null;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() { recreate(); }
                });
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url != null && url.startsWith("file:///android_asset/")) {
                    return false;
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                              ValueCallback<Uri[]> callback,
                                              FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                // No EXTRA_MIME_TYPES restriction: ebook formats (mobi, cbr,
                // fb2, md, ...) report inconsistent or unknown MIME types, so
                // filtering by MIME would hide valid files. The page checks
                // extensions itself.
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                boolean allowMultiple =
                    params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple);

                try {
                    startActivityForResult(
                        Intent.createChooser(intent, "Select book(s)"),
                        FILECHOOSER_RESULTCODE
                    );
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this,
                        "No file picker app available.", Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }
        });

        tts = new TextToSpeech(this, this);
        webView.addJavascriptInterface(new TTSBridge(), "AndroidTTS");
        webView.addJavascriptInterface(new FileBridge(), "AndroidBridge");

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS || tts == null) {
            ttsReady = false;
            return;
        }
        ttsReady = true;
        tts.setLanguage(Locale.US);

        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) { }

            @Override
            public void onDone(final String utteranceId) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        evalJs("window.__ttsOnDone && window.__ttsOnDone('" + utteranceId + "')");
                    }
                });
            }

            @Override
            public void onError(String utteranceId) {
                reportError(utteranceId);
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                reportError(utteranceId);
            }

            // No @Override: onRangeStart is API 26, absent from the API 23
            // compile stub; the runtime dispatches by exact signature.
            public void onRangeStart(final String utteranceId, final int start, final int end, int frame) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        evalJs("window.__ttsOnRangeStart && window.__ttsOnRangeStart('"
                            + utteranceId + "'," + start + "," + end + ")");
                    }
                });
            }

            private void reportError(final String utteranceId) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        evalJs("window.__ttsOnError && window.__ttsOnError('" + utteranceId + "')");
                    }
                });
            }
        });

        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                evalJs("window.__ttsOnReady && window.__ttsOnReady()");
            }
        });
    }

    private void evalJs(String js) {
        if (webView != null) {
            webView.evaluateJavascript(js, null);
        }
    }

    private class TTSBridge {
        @JavascriptInterface
        public String getVoices() {
            StringBuilder sb = new StringBuilder("[");
            if (ttsReady && tts != null) {
                try {
                    Set<Voice> voiceSet = tts.getVoices();
                    Voice defaultVoice = tts.getDefaultVoice();
                    if (voiceSet != null) {
                        boolean first = true;
                        for (Voice v : voiceSet) {
                            if (v == null) continue;
                            if (v.isNetworkConnectionRequired()) continue;
                            if (v.getFeatures() != null && v.getFeatures().contains(FEATURE_NOT_INSTALLED)) continue;
                            if (!first) sb.append(",");
                            first = false;
                            sb.append("{\"name\":\"").append(escape(v.getName()))
                              .append("\",\"lang\":\"").append(escape(v.getLocale().toLanguageTag()))
                              .append("\",\"default\":").append(v.equals(defaultVoice))
                              .append("}");
                        }
                    }
                } catch (Exception e) {
                    // fall through to an empty array
                }
            }
            sb.append("]");
            return sb.toString();
        }

        @JavascriptInterface
        public void speak(String utteranceId, String text, String voiceName, float rate, float pitch) {
            if (!ttsReady || tts == null || text == null || text.length() == 0) return;
            tts.stop();
            if (voiceName != null && voiceName.length() > 0) {
                try {
                    for (Voice v : tts.getVoices()) {
                        if (v != null && voiceName.equals(v.getName())) {
                            tts.setVoice(v);
                            break;
                        }
                    }
                } catch (Exception e) { /* keep the current voice */ }
            }
            tts.setSpeechRate(clamp(rate, 0.1f, 3.0f));
            tts.setPitch(clamp(pitch, 0.1f, 2.0f));
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        }

        @JavascriptInterface
        public void stop() {
            if (tts != null) tts.stop();
        }

        private float clamp(float v, float lo, float hi) {
            return Math.max(lo, Math.min(hi, v));
        }

        private String escape(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\").replace("\"", "\\\"");
        }
    }

    /**
     * File saving and small device helpers exposed to the page as
     * AndroidBridge. Saving is deliberately CHUNKED: a single bridge call that
     * carries a whole export as one argument fails inside the bridge's own
     * marshaling for large payloads (before any of our code can catch it).
     * The page sends the file as a sequence of small base64 chunks instead.
     */
    private class FileBridge {
        @JavascriptInterface
        public boolean beginSave(String filename, String mime) {
            abortSave();
            try {
                ContentResolver resolver = getContentResolver();
                ContentValues cv = new ContentValues();
                cv.put(COL_DISPLAY_NAME, filename);
                cv.put(COL_MIME_TYPE, mime);
                cv.put(COL_RELATIVE_PATH, "Download/LoudReader");
                cv.put(COL_IS_PENDING, 1);
                Uri item = resolver.insert(DOWNLOADS_COLLECTION, cv);
                if (item == null) return false;
                OutputStream out = resolver.openOutputStream(item);
                if (out == null) {
                    resolver.delete(item, null, null);
                    return false;
                }
                saveUri = item;
                saveOut = out;
                return true;
            } catch (Exception e) {
                abortSave();
                return false;
            }
        }

        @JavascriptInterface
        public boolean appendChunk(String base64Chunk) {
            if (saveOut == null) return false;
            try {
                byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                saveOut.write(bytes);
                return true;
            } catch (Exception e) {
                abortSave();
                return false;
            }
        }

        @JavascriptInterface
        public String finishSave() {
            if (saveOut == null || saveUri == null) return "";
            try {
                saveOut.flush();
                saveOut.close();
                saveOut = null;
                ContentValues cv = new ContentValues();
                cv.put(COL_IS_PENDING, 0);
                getContentResolver().update(saveUri, cv, null, null);
                String result = saveUri.toString();
                saveUri = null;
                return result;
            } catch (Exception e) {
                abortSave();
                return "";
            }
        }

        @JavascriptInterface
        public void setVolumeKeyPaging(boolean on) {
            volumeKeyPaging = on;
        }

        @JavascriptInterface
        public boolean copyText(String text) {
            try {
                android.content.ClipboardManager cm =
                    (android.content.ClipboardManager) getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Loud Reader", text));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean lookupWord(String word) {
            try {
                Intent i = new Intent(Intent.ACTION_WEB_SEARCH);
                i.putExtra("query", "define " + word);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                try {
                    Intent v = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://www.google.com/search?q=" + Uri.encode("define " + word)));
                    v.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(v);
                    return true;
                } catch (Exception e2) {
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void abortSave() {
            try { if (saveOut != null) saveOut.close(); } catch (Exception e) { }
            saveOut = null;
            try {
                if (saveUri != null) getContentResolver().delete(saveUri, null, null);
            } catch (Exception e) { }
            saveUri = null;
        }

        @JavascriptInterface
        public boolean openUri(String uri, String mime) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(Uri.parse(uri), mime);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return true;
            } catch (ActivityNotFoundException e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this,
                            "No app installed that can open this file.", Toast.LENGTH_LONG).show();
                    }
                });
                return false;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        /**
         * Lets the page import a whole folder (with subfolders) from the
         * device. Launches the system folder picker (Storage Access
         * Framework); the result is delivered back to the page as
         * window.__onFolderManifest(manifest) -- or
         * window.__onFolderCancelled() if the user backs out -- once the
         * (potentially large) tree has been walked off the UI thread.
         */
        @JavascriptInterface
        public void pickFolder() {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            try {
                startActivityForResult(intent, FOLDER_PICK_RESULTCODE);
            } catch (Exception e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() { evalJs("window.__onFolderCancelled && window.__onFolderCancelled()"); }
                });
            }
        }

        /**
         * Pulls up to `length` bytes starting at `offset` from a previously
         * manifested import entry, base64-encoded. Returns "" at EOF or on
         * any error. The page is expected to call this with strictly
         * increasing offsets for one id until it gets back a chunk shorter
         * than requested (or empty) -- see the single-slot stream cache this
         * relies on.
         */
        @JavascriptInterface
        public String readImportChunk(String id, long offset, int length) {
            try {
                if (id == null || length <= 0) return "";
                if (!id.equals(curImportId)) {
                    closeImportStream();
                    Uri uri = importEntries.get(id);
                    if (uri == null) return "";
                    curImportStream = getContentResolver().openInputStream(uri);
                    curImportId = id;
                    curImportPos = 0;
                }
                if (curImportStream == null) return "";
                if (offset < curImportPos) return ""; // backwards seek isn't supported; bail safely
                long toSkip = offset - curImportPos;
                while (toSkip > 0) {
                    long skipped = curImportStream.skip(toSkip);
                    if (skipped <= 0) break;
                    toSkip -= skipped; curImportPos += skipped;
                }
                byte[] buf = new byte[length];
                int total = 0;
                while (total < length) {
                    int n = curImportStream.read(buf, total, length - total);
                    if (n < 0) break;
                    total += n;
                }
                curImportPos += total;
                if (total <= 0) { closeImportStream(); return ""; }
                String b64 = Base64.encodeToString(buf, 0, total, Base64.NO_WRAP);
                if (total < length) closeImportStream(); // this call reached EOF
                return b64;
            } catch (Exception e) {
                closeImportStream();
                return "";
            }
        }

        private void closeImportStream() {
            try { if (curImportStream != null) curImportStream.close(); } catch (Exception e) { /* ignore */ }
            curImportStream = null; curImportId = null; curImportPos = 0;
        }
    }

    private void handleFolderPickResult(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            evalJs("window.__onFolderCancelled && window.__onFolderCancelled()");
            return;
        }
        final Uri treeUri = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            // Not fatal: we still have access to read within this activity session either way.
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String manifestJson = walkFolderTree(treeUri);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        evalJs("window.__onFolderManifest && window.__onFolderManifest(" + manifestJson + ")");
                    }
                });
            }
        }).start();
    }

    /** Walks the picked tree (background thread) and returns a JSON array literal of
     *  {id,name,path,size} for every file found, breadth across subfolders included.
     *  Also fills importEntries so readImportChunk can later resolve each id to its Uri. */
    private String walkFolderTree(Uri treeUri) {
        importEntries.clear();
        StringBuilder sb = new StringBuilder("[");
        try {
            String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
            String rootName = queryDisplayName(treeUri, treeDocId);
            if (rootName == null || rootName.length() == 0) rootName = "Folder";
            int[] counter = {0};
            boolean[] firstRef = {true};
            walkDocTree(treeUri, treeDocId, rootName, sb, firstRef, counter);
        } catch (Exception e) {
            // Return whatever was collected before the error.
        }
        sb.append("]");
        return sb.toString();
    }

    private String queryDisplayName(Uri treeUri, String docId) {
        Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
        Cursor c = null;
        try {
            c = getContentResolver().query(docUri,
                new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
            // fall through
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private void walkDocTree(Uri treeUri, String parentDocId, String path, StringBuilder sb,
                              boolean[] firstRef, int[] counter) {
        if (counter[0] >= MAX_IMPORT_FILES) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        Cursor c = null;
        try {
            c = getContentResolver().query(childrenUri, new String[]{
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE
            }, null, null, null);
            if (c == null) return;
            while (c.moveToNext() && counter[0] < MAX_IMPORT_FILES) {
                String docId = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long size = c.getLong(3);
                if (name == null || docId == null) continue;
                String childPath = path + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walkDocTree(treeUri, docId, childPath, sb, firstRef, counter);
                } else {
                    String id = "f" + counter[0];
                    counter[0]++;
                    Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                    importEntries.put(id, docUri);
                    if (!firstRef[0]) sb.append(",");
                    firstRef[0] = false;
                    sb.append("{\"id\":\"").append(id)
                      .append("\",\"name\":\"").append(jsonEscape(name))
                      .append("\",\"path\":\"").append(jsonEscape(childPath))
                      .append("\",\"size\":").append(size)
                      .append("}");
                }
            }
        } catch (Exception e) {
            // Skip this subtree on error; whatever was already appended to sb stands.
        } finally {
            if (c != null) c.close();
        }
    }

    private static String jsonEscape(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format(Locale.US, "\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.toString();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FOLDER_PICK_RESULTCODE) {
            handleFolderPickResult(resultCode, data);
            return;
        }
        if (requestCode != FILECHOOSER_RESULTCODE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (filePathCallback == null) {
            return;
        }

        Uri[] results = null;
        if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
        }

        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    private boolean volumeKeyPaging = false;

    @Override
    public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
        if (volumeKeyPaging && webView != null
                && (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP
                    || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getRepeatCount() == 0) {
                int dir = (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP) ? -1 : 1;
                evalJs("window.__volKey&&window.__volKey(" + dir + ")");
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, android.view.KeyEvent event) {
        if (volumeKeyPaging && (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP
                || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    /**
     * Back is routed to the page first: it closes whatever is open (dialog,
     * panel, reader -> shelf, folder -> parent). Only when the page reports
     * nothing left to close does the app actually exit.
     */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return window.__handleBack?window.__handleBack():false}catch(e){return false}})()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (!"true".equals(value)) {
                        finish();
                    }
                }
            });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        try { if (saveOut != null) saveOut.close(); } catch (Exception e) { }
        try { if (curImportStream != null) curImportStream.close(); } catch (Exception e) { }
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
