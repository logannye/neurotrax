#!/usr/bin/env bash

set -euo pipefail

required_files=(
  "README.md"
  "AGENTS.md"
  "SECURITY.md"
  "docs/architecture.md"
  "docs/safety.md"
  "docs/validation.md"
  "apps/capture-web/README.md"
  "apps/clinician-review/README.md"
  "agents/guided-capture/README.md"
  "agents/personal-trajectory/README.md"
  "agents/evidence-card/README.md"
  "packages/contracts/README.md"
  "protocols/macbook-check-in.v0.1.json"
  "examples/prior-encounter-observation.example.json"
  "examples/encounter-observation.example.json"
  "examples/trajectory-comparison.example.json"
  "examples/evidence-card.example.json"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

node -e '
  const fs = require("node:fs");
  const files = [
    "package.json",
    "protocols/macbook-check-in.v0.1.json",
    "examples/prior-encounter-observation.example.json",
    "examples/encounter-observation.example.json",
    "examples/trajectory-comparison.example.json",
    "examples/evidence-card.example.json"
  ];
  for (const file of files) {
    JSON.parse(fs.readFileSync(file, "utf8"));
  }
'

agent_count="$(find agents -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [[ "$agent_count" != "3" ]]; then
  echo "Expected exactly 3 top-level agents; found $agent_count." >&2
  exit 1
fi

if find . -type f \
  \( -name "*.wav" -o -name "*.mp3" -o -name "*.m4a" -o -name "*.mp4" -o -name "*.mov" -o -name "*.webm" \) \
  -print -quit | grep -q .; then
  echo "Captured media must not be committed." >&2
  exit 1
fi

echo "Neuro Encounter structure is valid."
