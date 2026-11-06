#!/bin/sh
# Builds dist/move-out-proof.zip (the Skill package to upload) after the official checker passes.
set -eu
node tools/check-skill.mjs skill/move-out-proof
mkdir -p dist
rm -f dist/move-out-proof.zip
(cd skill && zip -qr ../dist/move-out-proof.zip move-out-proof -x '*.DS_Store')
unzip -l dist/move-out-proof.zip
