#!/bin/sh -l
pnpm i
pnpm tsx -p tsconfig.json
cp -r template build/template
pnpm publish --access=public --no-git-checks build