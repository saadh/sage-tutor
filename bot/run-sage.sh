#!/bin/bash
# Sage supervisor — keeps the bot alive through crashes and stream deaths.
cd "$(dirname "$0")"
while true; do
  echo "[supervisor] starting sage $(date)"
  npm run dev:sage
  echo "[supervisor] sage exited ($?) — restarting in 3s"
  sleep 3
done
