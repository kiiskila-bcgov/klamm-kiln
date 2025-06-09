#!/bin/sh

echo "🏁 Starting container with runtime build..."

# Ensure /app is group-writable
chmod -R g+w /app

# Write all VITE_* env vars dynamically to .env (use tee for permissions)
printenv | grep '^VITE_' | tee .env > /dev/null

# Optional: Rebuild only if dynamic .env vars are required
npm run build

# Serve the app
serve -s dist -l 8080
