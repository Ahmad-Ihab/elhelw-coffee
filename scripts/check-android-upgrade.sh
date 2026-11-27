#!/usr/bin/env bash
set -euo pipefail
adb install previous/app-release.apk
adb install -r candidate/app-release.apk
adb shell am start -W -n com.elhelwcoffee.app/.MainActivity | tee /tmp/elhelw-start.log
grep -q 'Status: ok' /tmp/elhelw-start.log
for attempt in $(seq 1 25); do
  if adb shell uiautomator dump /sdcard/elhelw-view.xml > /dev/null 2>&1 &&
     adb shell cat /sdcard/elhelw-view.xml | grep -F 'name@example.com' > /dev/null; then
    echo "Upgraded app opened the sign-in form"
    exit 0
  fi
  sleep 2
done
adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' || true
exit 1
