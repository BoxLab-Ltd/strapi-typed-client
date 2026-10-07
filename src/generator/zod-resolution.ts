import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

// Output dir first: that is where the consumer's bundler resolves zod, and a monorepo root may hoist another major
export function resolveZod(outputDir: string): string {
    for (const base of [path.resolve(outputDir), process.cwd()]) {
        let pkgPath: string
        try {
            pkgPath = createRequire(path.join(base, 'noop.js')).resolve(
                'zod/package.json',
            )
        } catch {
            continue
        }
        const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
            version: string
        }
        if (Number(version.split('.')[0]) < 4) {
            throw new Error(
                `--validation zod needs zod 4, but found zod ${version} (${path.dirname(pkgPath)}). Upgrade it, e.g. \`npm i zod@^4\`.`,
            )
        }
        return path.dirname(pkgPath)
    }
    throw new Error(
        '--validation zod needs the `zod` package (v4) installed in your project, e.g. `npm i zod`.',
    )
}
