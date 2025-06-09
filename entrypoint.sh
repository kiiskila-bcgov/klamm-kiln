#!/bin/sh

echo "🏁 Starting container with runtime build..."

# Write all VITE_* env vars dynamically to .env
printenv | grep '^VITE_' > .env

# Install only production deps (optional: run if not already)
npm ci --omit=dev

# Build the app using pod-provided env vars
npm run build

# Serve it
serve -s dist -l 8080
