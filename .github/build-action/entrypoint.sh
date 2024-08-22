#!/bin/sh -l
pnpm i --ignore-scripts
pnpm tsx -p tsconfig.json
cp -r template build/template
pnpm publish --access=public --no-git-checks build