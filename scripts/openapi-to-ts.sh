#!/bin/bash

# This script is used to generate TypeScript types from an OpenAPI spec.

npx openapi-typescript https://dev.api.gambitengine.com/openapi.json --output src/types/gambitengine.d.ts
