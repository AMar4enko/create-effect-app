#!/bin/sh -l
pnpm i --ignore-scripts
tsc -p tsconfig.json
cp -r template build/template