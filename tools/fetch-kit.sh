#!/bin/sh
# Downloads UGREEN's official Skill Creation Tool (uliya-skill-kit 0.7.3) into .kit/ for the checker.
# Source: https://ai.ugreen.com/pages/hackathon-starter-kit
set -eu
mkdir -p .kit
curl -sSL -o .kit/kit.zip "https://cdn.shopify.com/s/files/1/0630/9416/1602/files/uliya-skill-kit-0.7.3-en.zip?v=1790578898"
unzip -q -o .kit/kit.zip -d .kit
rm .kit/kit.zip
echo "kit ready: .kit/uliya-skill-kit"
