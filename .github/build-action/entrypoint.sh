#!/bin/sh -l
pnpm i --ignore-scripts
tsc -p tsconfig.json
cp -r template build/template
cd build
pnpm i --ignore-scripts
pnpm publish  --ignore-scripts --access=public --no-git-checks build