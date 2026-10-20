#!/usr/bin/env bash
# Loud Reader v2 - APK build, following APK_BUILD_RUNBOOK.md (section 6 + 7).
# Prereqs (runbook section 1): aapt, javac(ecj), dx, zipalign, apksigner, baksmali, python3.
#
#   KS=/path/to/loudreader.keystore KS_PASS=... ./build_apk.sh
#
# Optional: KS_ALIAS (default loudreaderkey), KEY_PASS (default = KS_PASS), ANDROID_JAR.
# IMPORTANT: updates only install over v1 if signed with the SAME keystore as v1.
# GEN_KEYSTORE=1 creates a brand-new keystore (a NEW signing identity: v1 must be uninstalled first).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
ANDROID_JAR="${ANDROID_JAR:-/usr/share/java/com.android.android-23.jar}"
PKG_PATH="com/devise/loudreader/app"
KS_ALIAS="${KS_ALIAS:-loudreaderkey}"
: "${KS:?set KS=/path/to/loudreader.keystore}"
: "${KS_PASS:?set KS_PASS=<keystore password>}"
KEY_PASS="${KEY_PASS:-$KS_PASS}"
OUT_NAME="${OUT_NAME:-LoudReader_v2.apk}"

for t in aapt javac dx zipalign apksigner baksmali zip python3; do
  command -v "$t" >/dev/null || { echo "missing tool: $t (see runbook section 1)"; exit 1; }
done
[ -f "$ANDROID_JAR" ] || { echo "missing $ANDROID_JAR"; exit 1; }

if [ ! -f "$KS" ]; then
  if [ "${GEN_KEYSTORE:-0}" = "1" ]; then
    keytool -genkeypair -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
      -keystore "$KS" -storepass "$KS_PASS" -keypass "$KEY_PASS" \
      -dname "CN=Loud Reader, OU=Devise, O=Devise, L=City, ST=State, C=IN" -noprompt
  else
    echo "Keystore $KS not found. Use the v1 keystore (so the APK can update v1), or GEN_KEYSTORE=1 for a new identity."; exit 1
  fi
fi

echo "== 0. rule checks =="
if grep -rnE '\) *->|::' apk_build/src --include=*.java | grep -v '^\S*:[0-9]*:\s*\*\|//' ; then
  echo "lambda / method reference found in Java (runbook rule 0.1)"; exit 1
fi

echo "== 1. assemble assets/index.html =="
python3 tools/build_html.py apk_build/assets/index.html

cd apk_build
rm -rf bin && mkdir -p bin/classes
echo "== 2. R.java =="
aapt package -f -m -J src -M AndroidManifest.xml -S res -I "$ANDROID_JAR"
echo "== 3. compile =="
javac -proc:none -source 1.7 -target 1.7 -classpath "$ANDROID_JAR" -d bin/classes \
  src/$PKG_PATH/MainActivity.java src/$PKG_PATH/R.java
find bin/classes -name '*.class' | grep -q . || { echo "no .class files produced"; exit 1; }
echo "== 4. dex =="
dx --dex --output=bin/classes.dex bin/classes
[ -s bin/classes.dex ] || { echo "no classes.dex"; exit 1; }
rm -rf /tmp/dex_verify
baksmali d bin/classes.dex -o /tmp/dex_verify
if grep -rl "invoke-custom\|invoke-polymorphic" /tmp/dex_verify/; then
  echo "invokedynamic found in DEX (runbook rule 0.4)"; exit 1
fi
echo "DEX clean"
echo "== 5-6. package + inject dex =="
aapt package -f -M AndroidManifest.xml -S res -A assets -I "$ANDROID_JAR" -F bin/unsigned.apk
(cd bin && zip -j unsigned.apk classes.dex)
echo "== 7. align (before signing) =="
zipalign -f -p 4 bin/unsigned.apk bin/aligned.apk
zipalign -c -v 4 bin/aligned.apk | tail -3
echo "== 8. sign =="
apksigner sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" --key-pass "pass:$KEY_PASS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "bin/$OUT_NAME" bin/aligned.apk
echo "== 9. verify =="
apksigner verify --verbose "bin/$OUT_NAME"
aapt dump badging "bin/$OUT_NAME" | head -5
echo
echo "DONE: $ROOT/apk_build/bin/$OUT_NAME"
