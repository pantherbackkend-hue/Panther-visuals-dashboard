#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== Starting test environment ==="

# Start MMS, seed, and launch server in background
node tests/setup/start-server.mjs &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:7890/login > /dev/null 2>&1; then
    echo "Server is ready on http://localhost:7890"
    break
  fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Server process died!"
    exit 1
  fi
  sleep 1
done

echo "=== Running Playwright tests ==="
npx playwright test --config=playwright.config.mjs "$@" || TEST_EXIT=$?

echo "=== Shutting down test environment ==="
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

exit ${TEST_EXIT:-0}
