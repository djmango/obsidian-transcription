#!/bin/bash

# This script is used to generate TypeScript types from an OpenAPI spec.

npx openapi-typescript https://api.swiftink.io/openapi.json --output src/types/swiftink.d.ts
