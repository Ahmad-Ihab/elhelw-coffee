#!/usr/bin/env bash
set -euo pipefail
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell settings put secure immersive_mode_confirmations confirmed
adb install previous/app-release.apk
adb install -r candidate/app-release.apk
adb shell am start -W -n com.elhelwcoffee.app/.MainActivity | tee /tmp/elhelw-start.log
grep -q 'Status: ok' /tmp/elhelw-start.log
mkdir -p /tmp/elhelw-screen
for attempt in $(seq 1 15); do
  if adb shell uiautomator dump /sdcard/elhelw-view.xml > /dev/null 2>&1; then
    adb shell cat /sdcard/elhelw-view.xml > /tmp/elhelw-screen/ui.xml
    if python3 - <<'PY'
import xml.etree.ElementTree as ET
nodes = ET.parse('/tmp/elhelw-screen/ui.xml').iter('node')
labels = [node.get('text','') + ' ' + node.get('content-desc','') for node in nodes if node.get('package')=='com.elhelwcoffee.app']
raise SystemExit(0 if any('تسجيل الدخول' in s or 'name@example.com' in s or 'البريد الإلكتروني' in s for s in labels) else 1)
PY
    then
      echo "Verified the sign-in form after Android upgrade"
      exit 0
    fi
  fi
  sleep 2
done
adb exec-out screencap -p > /tmp/elhelw-screen/login.png
python3 - <<'PY'
import xml.etree.ElementTree as ET
for n in ET.parse('/tmp/elhelw-screen/ui.xml').iter('node'):
 print(n.get('package'), n.get('class'), n.get('text'), n.get('content-desc'))
PY
adb logcat -d | grep -Ei 'Capacitor/Console|CONSOLE\(|FATAL EXCEPTION|AndroidRuntime:|webview.*version|net::ERR_' | tail -70 || true
if command -v tesseract >/dev/null; then
  tesseract /tmp/elhelw-screen/login.png /tmp/elhelw-screen/ocr -l eng 2>/dev/null || true
  if grep -Ei 'name.?@.?example\.com' /tmp/elhelw-screen/ocr.txt; then
    echo "Verified the visible email field in the Android sign-in form"
    exit 0
  fi
fi
exit 1
