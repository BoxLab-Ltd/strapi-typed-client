import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ts from 'typescript'
import { Generator } from '../../../src/generator/index.js'
import { TypesGenerator } from '../../../src/generator/types-generator.js'
import { isSplitTypesOutput } from '../../../src/shared/client-header.js'
import type { ParsedSchema } from '../../../src/schema-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

// Public names must match between layouts; the underscore helpers are exported
// in split mode only because the per-collection files share them
function exportedNames(dir: string): string[] {
    const program = ts.createProgram([path.join(dir, 'types.ts')], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        noEmit: true,
    })
    const checker = program.getTypeChecker()
    const sf = program.getSourceFile(path.join(dir, 'types.ts'))!
    const symbol = checker.getSymbolAtLocation(sf)!
    return checker
        .getExportsOfModule(symbol)
        .map(s => s.getName())
        .filter(n => !n.startsWith('_'))
        .sort()
}

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap(e =>
            e.isDirectory()
                ? walk(path.join(dir, e.name)).map(f => `${e.name}/${f}`)
                : [e.name],
        )
        .sort()
}

describe('split types', { timeout: 60_000 }, () => {
    let tmp: string
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-types-'))
    })
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('single-file generation is unchanged by the split code path', () => {
        const gen = new TypesGenerator()
        expect(gen.generate(mockSchema)).toBe(gen.generate(mockSchema))
        expect(gen.generate(mockSchema)).not.toContain('./base.js')
    })

    it('puts each content type and component category in its own file', () => {
        const files = new TypesGenerator().generateSplit(mockSchema)
        const names = Object.keys(files)
        expect(names).toContain('types.ts')
        expect(names).toContain('base.ts')
        for (const ct of mockSchema.contentTypes) {
            const file = names.find(
                n =>
                    n.startsWith('collections/') &&
                    !n.startsWith('collections/components/') &&
                    new RegExp(`export interface ${ct.cleanName}\\b`).test(
                        files[n]!,
                    ),
            )
            expect(file, ct.cleanName).toBeDefined()
        }
        expect(names.some(n => n.startsWith('collections/components/'))).toBe(
            true,
        )
        expect(files['types.ts']).toContain("export * from './base.js'")
        expect(files['base.ts']).toContain('export interface MediaFile')
    })

    it('exports the same public names as the single file (ts)', async () => {
        const single = path.join(tmp, 'single')
        const split = path.join(tmp, 'split')
        await new Generator(single).generate(mockSchema, { format: 'ts' })
        await new Generator(split).generate(mockSchema, {
            format: 'ts',
            splitTypes: true,
        })
        expect(exportedNames(split)).toEqual(exportedNames(single))
        expect(isSplitTypesOutput(split)).toBe(true)
        expect(isSplitTypesOutput(single)).toBe(false)
    })

    it('compiles to .js + .d.ts per file in js format', async () => {
        await new Generator(tmp).generate(mockSchema, { splitTypes: true })
        const files = walk(tmp)
        expect(files).toContain('base.js')
        expect(files).toContain('base.d.ts')
        expect(files.some(f => /^collections\/.+\.d\.ts$/.test(f))).toBe(true)
        expect(files).toContain('types.d.ts')
        expect(isSplitTypesOutput(tmp)).toBe(true)
    })

    it('handles relations that point at each other', async () => {
        const schema: ParsedSchema = {
            components: [],
            contentTypes: ['Alpha', 'Beta'].map((name, i) => ({
                name: `Api${name}${name}`,
                cleanName: name,
                collectionName: name.toLowerCase() + 's',
                singularName: name.toLowerCase(),
                pluralName: name.toLowerCase() + 's',
                kind: 'collection' as const,
                attributes: [],
                relations: [
                    {
                        name: 'other',
                        relationType: 'oneToOne' as const,
                        target: `api::x.${i ? 'alpha' : 'beta'}`,
                        targetType: i ? 'Alpha' : 'Beta',
                        required: false,
                    },
                ],
                media: [],
                components: [],
                dynamicZones: [],
            })),
        }
        // Generator type-checks the result and throws on any error
        await new Generator(tmp).generate(schema, {
            format: 'ts',
            splitTypes: true,
        })
        const alpha = fs.readFileSync(
            path.join(tmp, 'collections/alpha.ts'),
            'utf-8',
        )
        expect(alpha).toContain("from './beta'")
    })

    it('removes generated split files when switching back, keeping foreign ones', async () => {
        fs.writeFileSync(path.join(tmp, 'base.ts'), 'export const mine = 1\n')
        fs.mkdirSync(path.join(tmp, 'collections'))
        fs.writeFileSync(
            path.join(tmp, 'collections/mine.ts'),
            'export const mine = 2\n',
        )
        const gen = new Generator(tmp)
        await expect(
            gen.generate(mockSchema, { format: 'ts', splitTypes: true }),
        ).resolves.toBeUndefined()
        // our files replaced theirs only where the names collided: base.ts is regenerated
        await gen.generate(mockSchema, { format: 'ts' })
        const left = walk(tmp)
        expect(left).not.toContain('base.ts')
        expect(left.filter(f => f.startsWith('collections/'))).toEqual([
            'collections/mine.ts',
        ])
        expect(isSplitTypesOutput(tmp)).toBe(false)
    })

    it('drops the file of a removed collection and leaves the others untouched', async () => {
        const lonely = {
            ...mockSchema.contentTypes[0]!,
            name: 'ApiLonelyLonely',
            cleanName: 'Lonely',
            collectionName: 'lonelies',
            singularName: 'lonely',
            pluralName: 'lonelies',
            relations: [],
            media: [],
            components: [],
            dynamicZones: [],
        }
        const gen = new Generator(tmp)
        await gen.generate(
            {
                ...mockSchema,
                contentTypes: [...mockSchema.contentTypes, lonely],
            },
            { format: 'ts', splitTypes: true },
        )
        expect(walk(tmp)).toContain('collections/lonely.ts')

        const keepPath = path.join(
            tmp,
            walk(tmp).find(
                f =>
                    f.startsWith('collections/') &&
                    !f.includes('components/') &&
                    !f.includes('lonely'),
            )!,
        )
        const old = new Date(2020, 0, 1)
        fs.utimesSync(keepPath, old, old)

        await gen.generate(mockSchema, { format: 'ts', splitTypes: true })

        expect(walk(tmp)).not.toContain('collections/lonely.ts')
        expect(fs.statSync(keepPath).mtime.getTime()).toBe(old.getTime())
    })
})
