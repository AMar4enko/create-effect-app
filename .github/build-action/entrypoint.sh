#!/bin/sh -l
pnpm i --ignore-scripts
node_modules/.bin/tsc -p tsconfig.json
cp -r template build/template