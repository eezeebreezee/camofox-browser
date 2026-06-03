#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"
export CAMOFOX_HEADLESS="${CAMOFOX_HEADLESS:-false}"
export CAMOFOX_VNC_PORT="${CAMOFOX_VNC_PORT:-5900}"
export CAMOFOX_NOVNC_PORT="${CAMOFOX_NOVNC_PORT:-6080}"

# Containers committed from a live VNC session may contain stale X locks.
rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}" 2>/dev/null || true

Xvfb "$DISPLAY" -screen 0 "${XVFB_SCREEN:-1440x900x24}" -nolisten tcp &
XVFB_PID=$!

# Wait for X socket.
for i in $(seq 1 50); do
  [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ] && break
  sleep 0.1
done

openbox >/tmp/openbox.log 2>&1 &
OPENBOX_PID=$!

x11vnc -display "$DISPLAY" -forever -shared -nopw -listen 0.0.0.0 -rfbport "$CAMOFOX_VNC_PORT" -noxdamage -repeat -xkb -quiet &
X11VNC_PID=$!

websockify --web=/usr/share/novnc/ "$CAMOFOX_NOVNC_PORT" localhost:"$CAMOFOX_VNC_PORT" >/tmp/novnc.log 2>&1 &
WEBSOCKIFY_PID=$!

cleanup() {
  kill "$WEBSOCKIFY_PID" "$X11VNC_PID" "$OPENBOX_PID" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Keep the visible browser window inside the VNC desktop. Without a WM/resize pass,
# Camoufox can create a window larger than the framebuffer, which looks cropped in
# both noVNC and raw VNC clients.
(
  while true; do
    for w in $(xdotool search --onlyvisible --class Camoufox 2>/dev/null || true); do
      xdotool windowmove "$w" 0 0 2>/dev/null || true
      xdotool windowsize "$w" "${CAMOFOX_WINDOW_WIDTH:-1180}" "${CAMOFOX_WINDOW_HEIGHT:-760}" 2>/dev/null || true
    done
    sleep 2
  done
) >/tmp/window-fit.log 2>&1 &
WINDOW_FIT_PID=$!

cleanup() {
  kill "$WINDOW_FIT_PID" "$WEBSOCKIFY_PID" "$X11VNC_PID" "$OPENBOX_PID" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node --max-old-space-size="${MAX_OLD_SPACE_SIZE:-128}" server.js
