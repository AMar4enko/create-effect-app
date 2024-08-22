#!/bin/sh -l
pnpm i --ignore-scripts
tsc -p tsconfig.json
cp -r template build/template
pnpm publish --access=public --no-git-checks build