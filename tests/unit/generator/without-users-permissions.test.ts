import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Generator } from '../../../src/generator/index.js'
import type { ParsedSchema } from '../../../src/schema-types.js'
import { mockSchema } from './fixtures/mock-schema.js'

// A Strapi with the users-permissions plugin disabled exposes no plugin::users-permissions.* types (#99)
const schemaWithoutUsersPermissions: ParsedSchema = {
    ...mockSchema,
    contentTypes: mockSchema.contentTypes
        .filter(ct => ct.name !== 'PluginUsersPermissionsUser')
        .map(ct => ({
            ...ct,
            relations: ct.relations.filter(
                r => !r.target.startsWith('plugin::users-permissions.'),
            ),
        })),
}

const tmpDirs: string[] = []

function outDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-types-no-up-'))
    tmpDirs.push(dir)
    return dir
}

describe('generation without the users-permissions plugin (#99)', () => {
    afterEach(() => {
        for (const d of tmpDirs.splice(0)) {
            fs.rmSync(d, { recursive: true, force: true })
        }
    })

    for (const format of ['ts', 'js'] as const) {
        it(`passes the type-check guard in ${format} mode`, async () => {
            const dir = outDir()
            await new Generator(dir).generate(schemaWithoutUsersPermissions, {
                endpoints: [],
                format,
            })
        })
    }

    it('emits no auth namespace or User references', async () => {
        const dir = outDir()
        await new Generator(dir).generate(schemaWithoutUsersPermissions, {
            endpoints: [],
            format: 'ts',
        })
        const client = fs.readFileSync(path.join(dir, 'client.ts'), 'utf-8')

        expect(client).not.toMatch(/\bUser\b/)
        expect(client).not.toContain('class AuthAPI')
        expect(client).not.toContain('UsersPermissionsUserAPI')
        expect(client).not.toMatch(/^\s*auth: AuthAPI/m)
    })

    it('keeps the auth namespace when the plugin is present', async () => {
        const dir = outDir()
        await new Generator(dir).generate(mockSchema, {
            endpoints: [],
            format: 'ts',
        })
        const client = fs.readFileSync(path.join(dir, 'client.ts'), 'utf-8')

        expect(client).toContain('class AuthAPI')
        expect(client).toMatch(/^\s*auth: AuthAPI/m)
    })
})
