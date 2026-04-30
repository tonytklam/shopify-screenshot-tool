#!/bin/bash

# Combine all arguments after the first one in case the URL had spaces
URL="${@:2}"

if [ -z "$1" ]; then
    echo "Shopify Screenshot Tool Shortcut"
    echo "=================================="
    echo "Usage:"
    echo "  bash screenshot.sh auth"
    echo "  bash screenshot.sh screenshot <url>"
    echo "  bash screenshot.sh ui"
    echo ""
    echo "Note: If your URL contains an '&' (ampersand), you MUST wrap the URL in quotes, or your terminal will cut it off."
    exit 1
fi

if [ "$1" == "auth" ]; then
    node auth.js
    exit 0
fi

if [ "$1" == "screenshot" ]; then
    if [ -z "$URL" ]; then
        echo "Error: Please provide a URL."
        exit 1
    fi
    echo "Capturing screenshot for: $URL"
    node agent-runner.js "{\"url\":\"$URL\"}"
    exit 0
fi

if [ "$1" == "ui" ]; then
    echo "🚀 Starting Screenshot UI..."
    # Open the browser after a short delay to let the server start
    (sleep 1.5 && open http://localhost:3333) &
    npm start
    exit 0
fi

echo "Unknown command: $1"
echo "Use 'auth', 'screenshot <url>', or 'ui'"
exit 1
