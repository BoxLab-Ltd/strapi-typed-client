#!/usr/bin/env node

/**
 * Strapi Types CLI
 *
 * Generate TypeScript types from Strapi schema
 *
 * Usage:
 *   npx strapi-types generate --url http://localhost:1337
 *   npx strapi-types check --url http://localhost:1337
 *   npx strapi-types watch --url http://localhost:1337
 *   npx strapi-types generate --local  # Use local .d.ts files
 */

import { Command } from 'commander'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import * as path from 'path'
import { createGenerateCommand } from './commands/generate.js'
import { createCheckCommand } from './commands/check.js'
import { createWatchCommand } from './commands/watch.js'

// Read package.json for version (ESM compatible)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageJsonPath = path.join(__dirname, '../../package.json')
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'))

const program = new Command()

program
    .name('strapi-types')
    .description('Generate TypeScript types from Strapi schema')
    .version(packageJson.version)

// Register commands
createGenerateCommand(program)
createCheckCommand(program)
createWatchCommand(program)

// Parse command line arguments
program.parse(process.argv)

// Show help if no command is provided
if (!process.argv.slice(2).length) {
    program.outputHelp()
}
