#!/bin/sh -l
pnpm i --ignore-scripts
tsc -p tsconfig.json
cp -r template build/template
cd build
pnpm i --ignore-scripts
pnpm publish --access=public --no-git-checks build --ignore-scripts