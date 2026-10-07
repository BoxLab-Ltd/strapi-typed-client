import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pathToFileURL } from 'url'
import * as ts from 'typescript'
import { Generator } from '../../../src/generator/index.js'
import { resolveZod } from '../../../src/generator/zod-resolution.js'
import type {
    Component,
    ContentType,
    ParsedSchema,
} from '../../../src/schema-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

/**
 * The validators promise two things, both checked against generated output:
 * a schema's input type agrees with the TS input type it validates, and a
 * schema accepts exactly the payloads that are valid for that TS type and that
 * a live Strapi 5 accepts — the corpus below is the one probed against a real
 * backend (accept = 201, reject = 400).
 */

const part: Component = {
    name: 'ProbePart',
    cleanName: 'ProbePart',
    category: 'probe',
    uid: 'probe.part',
    attributes: [
        { name: 'label', type: { kind: 'string' }, required: true },
        { name: 'n', type: { kind: 'integer' }, required: false },
    ],
    relations: [],
    media: [],
    components: [],
    dynamicZones: [],
}

const other: Component = {
    name: 'ProbeOther',
    cleanName: 'ProbeOther',
    category: 'probe',
    uid: 'probe.other',
    attributes: [{ name: 'flag', type: { kind: 'boolean' }, required: false }],
    relations: [],
    media: [],
    components: [],
    dynamicZones: [],
}

// Declared before `part` in the schema to exercise dependency ordering
const wrapper: Component = {
    name: 'ProbeWrapper',
    cleanName: 'ProbeWrapper',
    category: 'probe',
    uid: 'probe.wrapper',
    attributes: [],
    relations: [],
    media: [],
    components: [
        {
            name: 'inner',
            component: 'probe.part',
            componentType: 'ProbePart',
            repeatable: false,
            required: false,
        },
    ],
    dynamicZones: [],
}

const probe: ContentType = {
    name: 'ApiProbeProbe',
    cleanName: 'Probe',
    collectionName: 'probes',
    singularName: 'probe',
    pluralName: 'probes',
    kind: 'collection',
    attributes: [
        {
            name: 'title',
            type: { kind: 'string' },
            required: true,
            constraints: { minLength: 3, maxLength: 20 },
        },
        {
            name: 'code',
            type: { kind: 'string' },
            required: true,
            constraints: { regex: '^[A-Z]{2}\\d+$' },
        },
        {
            name: 'slugish',
            type: { kind: 'string' },
            required: false,
            constraints: { regex: '^[a-z-]+$' },
        },
        {
            name: 'short',
            type: { kind: 'string' },
            required: false,
            constraints: { minLength: 3 },
        },
        {
            name: 'count',
            type: { kind: 'integer' },
            required: true,
            constraints: { min: 1, max: 10 },
        },
        {
            name: 'big',
            type: { kind: 'biginteger' },
            required: false,
            defaultValue: '0',
        },
        { name: 'price', type: { kind: 'decimal' }, required: false },
        { name: 'flag', type: { kind: 'boolean' }, required: false },
        { name: 'day', type: { kind: 'date' }, required: false },
        { name: 't', type: { kind: 'time' }, required: false },
        { name: 'mail', type: { kind: 'email' }, required: false },
        {
            name: 'kind',
            type: { kind: 'enumeration', values: ['a', "it's"] },
            required: false,
        },
        {
            name: 'withDefault',
            type: { kind: 'string' },
            required: true,
            defaultValue: 'dflt',
        },
        { name: 'data', type: { kind: 'json' }, required: false },
        { name: 'body', type: { kind: 'blocks' }, required: false },
        {
            name: 'secret',
            type: { kind: 'password' },
            required: false,
            writeOnly: true,
        },
    ],
    relations: [
        {
            name: 'tags',
            relationType: 'manyToMany',
            target: 'api::category.category',
            targetType: 'Category',
            required: false,
        },
    ],
    media: [
        { name: 'cover', multiple: false, required: false },
        { name: 'gallery', multiple: true, required: false },
    ],
    components: [
        {
            name: 'reqPart',
            component: 'probe.part',
            componentType: 'ProbePart',
            repeatable: false,
            required: true,
        },
        {
            name: 'part',
            component: 'probe.part',
            componentType: 'ProbePart',
            repeatable: false,
            required: false,
        },
        {
            name: 'parts',
            component: 'probe.part',
            componentType: 'ProbePart',
            repeatable: true,
            required: false,
        },
        {
            name: 'wrapped',
            component: 'probe.wrapper',
            componentType: 'ProbeWrapper',
            repeatable: false,
            required: false,
        },
    ],
    dynamicZones: [
        {
            name: 'zone',
            components: ['probe.part', 'probe.other'],
            componentTypes: ['ProbePart', 'ProbeOther'],
            required: false,
        },
    ],
}

const schema: ParsedSchema = {
    contentTypes: [...mockSchema.contentTypes, probe],
    components: [wrapper, ...mockSchema.components, part, other],
}

// Inside the repo so the generated files resolve the installed zod
function repoTmpDir(prefix: string): string {
    const base = path.join(process.cwd(), 'node_modules', '.tmp')
    fs.mkdirSync(base, { recursive: true })
    return fs.mkdtempSync(path.join(base, prefix))
}

describe('generated Zod validators', () => {
    let dir: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let v: Record<string, any>

    beforeAll(async () => {
        dir = repoTmpDir('validation-')
        await new Generator(dir).generate(schema, {
            format: 'js',
            validation: 'zod',
        })
        v = await import(pathToFileURL(path.join(dir, 'validation.js')).href)
    })

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

    it('starts with the generated-file marker and stays out of the barrel', () => {
        const source = fs.readFileSync(path.join(dir, 'validation.js'), 'utf-8')
        expect(source.startsWith('// Auto-generated Strapi validators')).toBe(
            true,
        )
        expect(
            fs.readFileSync(path.join(dir, 'index.js'), 'utf-8'),
        ).not.toContain('validation')
    })

    const ok = {
        title: 'hello',
        code: 'AB1',
        count: 5,
        reqPart: { label: 'x' },
    }

    // [payload, live Strapi verdict] — create on a published-level request
    const createCorpus: [string, Record<string, unknown>, boolean][] = [
        ['baseline', ok, true],
        ['required title missing', { ...ok, title: undefined }, false],
        ['title null', { ...ok, title: null }, false],
        ['title below minLength', { ...ok, title: 'ab' }, false],
        ['required code regex fail', { ...ok, code: 'x' }, false],
        ['required code ""', { ...ok, code: '' }, false],
        ['optional regex field ""', { ...ok, slugish: '' }, true],
        ['optional regex field mismatch', { ...ok, slugish: 'A1' }, false],
        ['optional minLength field ""', { ...ok, short: '' }, false],
        ['count below min', { ...ok, count: 0 }, false],
        ['count not an integer', { ...ok, count: 5.5 }, false],
        ['required field with default omitted', ok, true],
        [
            'required field with default null',
            { ...ok, withDefault: null },
            false,
        ],
        ['required string ""', { ...ok, withDefault: '' }, true],
        ['big as number', { ...ok, big: 5 }, true],
        ['big beyond 2^53 as string', { ...ok, big: '9007199254740993' }, true],
        ['big not numeric', { ...ok, big: 'abc' }, false],
        ['time without seconds', { ...ok, t: '10:00' }, false],
        ['time with seconds', { ...ok, t: '10:00:00' }, true],
        ['time with millis', { ...ok, t: '10:00:00.000' }, true],
        ['email', { ...ok, mail: 'a@b.co' }, true],
        ['email without @', { ...ok, mail: 'foo' }, false],
        ['email without tld', { ...ok, mail: 'a@b' }, false],
        ['optional email ""', { ...ok, mail: '' }, false],
        ['enum value with a quote', { ...ok, kind: "it's" }, true],
        ['enum unknown', { ...ok, kind: 'c' }, false],
        ['enum ""', { ...ok, kind: '' }, false],
        ['json null', { ...ok, data: null }, true],
        ['blocks []', { ...ok, body: [] }, true],
        ['password', { ...ok, secret: 'pw' }, true],
        ['unknown key', { ...ok, nope: 1 }, false],
        ['id in body', { ...ok, id: 1 }, false],
        ['documentId in body', { ...ok, documentId: 'x' }, false],
        ['createdAt in body', { ...ok, createdAt: '2020-01-01' }, false],
        ['locale in body', { ...ok, locale: 'en' }, true],
        ['publishedAt in body', { ...ok, publishedAt: null }, true],
        ['relation documentId', { ...ok, tags: 'doc' }, true],
        [
            'relation [{ documentId }]',
            { ...ok, tags: [{ documentId: 'd' }] },
            true,
        ],
        ['relation [{ id }]', { ...ok, tags: [{ id: 1 }] }, true],
        [
            'relation mixed connect with locale/status',
            {
                ...ok,
                tags: {
                    connect: [
                        'a',
                        { documentId: 'b', locale: 'en', status: 'published' },
                    ],
                },
            },
            true,
        ],
        [
            'relation position start',
            {
                ...ok,
                tags: {
                    connect: [{ documentId: 'a', position: { start: true } }],
                },
            },
            true,
        ],
        [
            'relation set objects',
            { ...ok, tags: { set: [{ documentId: 'a' }] } },
            true,
        ],
        [
            'relation ops unknown key',
            { ...ok, tags: { connect: ['a'], foo: 1 } },
            false,
        ],
        ['relation null', { ...ok, tags: null }, true],
        ['media id', { ...ok, cover: 46 }, true],
        ['media null', { ...ok, cover: null }, true],
        ['multi media []', { ...ok, gallery: [] }, true],
        ['required component missing', { ...ok, reqPart: undefined }, false],
        ['required component null', { ...ok, reqPart: null }, false],
        ['component missing required field', { ...ok, part: { n: 1 } }, false],
        [
            'component with __component',
            { ...ok, part: { label: 'a', __component: 'probe.part' } },
            false,
        ],
        [
            'component unknown key',
            { ...ok, part: { label: 'a', zzz: 1 } },
            false,
        ],
        ['component with id', { ...ok, part: { label: 'a', id: 1 } }, true],
        ['optional component null', { ...ok, part: null }, true],
        ['repeatable component null', { ...ok, parts: null }, false],
        ['repeatable component []', { ...ok, parts: [] }, true],
        [
            'nested component',
            { ...ok, wrapped: { inner: { label: 'a' } } },
            true,
        ],
        [
            'dynamic zone',
            {
                ...ok,
                zone: [
                    { __component: 'probe.part', label: 'a' },
                    { __component: 'probe.other', flag: true },
                ],
            },
            true,
        ],
        [
            'dynamic zone entry without __component',
            { ...ok, zone: [{ label: 'a' }] },
            false,
        ],
        [
            'dynamic zone unknown __component',
            { ...ok, zone: [{ __component: 'probe.nope' }] },
            false,
        ],
        [
            'dynamic zone entry missing required',
            { ...ok, zone: [{ __component: 'probe.part' }] },
            false,
        ],
        [
            'dynamic zone entry unknown key',
            { ...ok, zone: [{ __component: 'probe.other', zzz: 1 }] },
            false,
        ],
        ['dynamic zone null', { ...ok, zone: null }, false],
    ]

    it.each(createCorpus)('create: %s', (_name, payload, accepted) => {
        const clean = Object.fromEntries(
            Object.entries(payload).filter(([, value]) => value !== undefined),
        )
        expect(v.ProbeCreateInputSchema.safeParse(clean).success).toBe(accepted)
    })

    it.each([
        ['empty update', {}, true],
        ['title null on update', { title: null }, false],
        ['title below minLength on update', { title: 'ab' }, false],
        ['count below min on update', { count: 0 }, false],
        ['unknown key on update', { nope: 1 }, false],
    ] as const)('update: %s', (_name, payload, accepted) => {
        expect(v.ProbeUpdateInputSchema.safeParse(payload).success).toBe(
            accepted,
        )
    })

    it('keeps a single locale key on an i18n content type', async () => {
        const i18nDir = repoTmpDir('validation-i18n-')
        try {
            await new Generator(i18nDir).generate(
                {
                    contentTypes: [
                        ...mockSchema.contentTypes,
                        {
                            ...probe,
                            attributes: [
                                ...probe.attributes,
                                {
                                    name: 'locale',
                                    type: { kind: 'string' },
                                    required: false,
                                },
                            ],
                        },
                    ],
                    components: schema.components,
                },
                { format: 'ts', validation: 'zod' },
            )
        } finally {
            fs.rmSync(i18nDir, { recursive: true, force: true })
        }
    })

    it('handles an empty dynamic zone and a null default', async () => {
        const edgeDir = repoTmpDir('validation-edge-')
        try {
            await new Generator(edgeDir).generate(
                {
                    contentTypes: [
                        ...mockSchema.contentTypes,
                        {
                            ...probe,
                            attributes: [
                                ...probe.attributes,
                                {
                                    name: 'nulled',
                                    type: { kind: 'string' },
                                    required: true,
                                    defaultValue: null,
                                },
                            ],
                            dynamicZones: [
                                {
                                    name: 'empty',
                                    components: [],
                                    componentTypes: [],
                                    required: false,
                                },
                            ],
                        },
                    ],
                    components: schema.components,
                },
                { format: 'ts', validation: 'zod' },
            )
            const types = fs.readFileSync(
                path.join(edgeDir, 'types.ts'),
                'utf-8',
            )
            const create = types.slice(
                types.indexOf('export interface ProbeCreateInput'),
            )
            expect(create).toMatch(/\n\s+nulled: string\n/)
        } finally {
            fs.rmSync(edgeDir, { recursive: true, force: true })
        }
    })

    it('refuses a content type and a component that share a name', async () => {
        const clashDir = repoTmpDir('validation-clash-')
        try {
            await expect(
                new Generator(clashDir).generate(
                    {
                        contentTypes: [
                            ...mockSchema.contentTypes,
                            { ...probe, cleanName: 'ProbePart' },
                        ],
                        components: schema.components,
                    },
                    { format: 'ts', validation: 'zod' },
                ),
            ).rejects.toThrow(/both map to ProbePart/)
        } finally {
            fs.rmSync(clashDir, { recursive: true, force: true })
        }
    })

    it('never injects values the caller did not send', () => {
        expect(v.ProbeCreateInputSchema.parse(ok)).toEqual(ok)
    })
})

describe('Zod schema and TS input type agreement', () => {
    it('every schema accepts exactly its TS input type, in both directions', async () => {
        const dir = repoTmpDir('agreement-')
        try {
            await new Generator(dir).generate(schema, {
                format: 'ts',
                validation: 'zod',
            })
            const names = [
                ...schema.contentTypes.map(c => c.cleanName),
                ...schema.components.map(c => c.cleanName),
            ].flatMap(n => [`${n}CreateInput`, `${n}UpdateInput`])
            const dzNames = [
                'ProbePart',
                'ProbeOther',
                'LandingHero',
                'LandingFeature',
            ].flatMap(n => [`${n}DzCreateInput`, `${n}DzUpdateInput`])
            const all = [...names, ...dzNames]
            const assertions = `import type { z } from 'zod'
import type * as T from './types'
import type * as V from './validation'
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
${all.map(n => `const _${n}: Same<z.input<typeof V.${n}Schema>, T.${n}> = true`).join('\n')}
`
            fs.writeFileSync(path.join(dir, 'agreement.ts'), assertions)
            for (const exactOptionalPropertyTypes of [false, true]) {
                const program = ts.createProgram(
                    [path.join(dir, 'agreement.ts')],
                    {
                        target: ts.ScriptTarget.ES2022,
                        module: ts.ModuleKind.ES2022,
                        moduleResolution: ts.ModuleResolutionKind.Bundler,
                        strict: true,
                        exactOptionalPropertyTypes,
                        noEmit: true,
                        skipLibCheck: true,
                    },
                )
                const errors = ts
                    .getPreEmitDiagnostics(program)
                    .map(d =>
                        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
                    )
                expect({ exactOptionalPropertyTypes, errors }).toEqual({
                    exactOptionalPropertyTypes,
                    errors: [],
                })
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe('resolveZod', () => {
    it('explains how to install zod when it cannot be found', () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-zod-'))
        const cwd = vi.spyOn(process, 'cwd').mockReturnValue(empty)
        try {
            expect(() => resolveZod(empty)).toThrow(/npm i zod/)
        } finally {
            cwd.mockRestore()
            fs.rmSync(empty, { recursive: true, force: true })
        }
    })

    it('rejects a zod older than 4', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'old-zod-'))
        const pkg = path.join(root, 'node_modules', 'zod')
        fs.mkdirSync(pkg, { recursive: true })
        fs.writeFileSync(
            path.join(pkg, 'package.json'),
            JSON.stringify({ name: 'zod', version: '3.23.8' }),
        )
        try {
            expect(() => resolveZod(root)).toThrow(/zod 3\.23\.8/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('prefers the zod next to the output over the one in cwd', () => {
        expect(resolveZod(process.cwd())).toBe(
            path.join(process.cwd(), 'node_modules', 'zod'),
        )
    })
})
