import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import endpointsService from '../../../src/plugin/server/src/services/endpoints.js'

function appWith(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-app-'))
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), content)
    }
    return root
}

function service(warnings: string[] = []) {
    return endpointsService({
        strapi: { log: { debug() {}, warn: (m: string) => warnings.push(m) } },
    })
}

describe('endpoints service', () => {
    it('keeps extra types under their own file even after another handler read it', async () => {
        const root = appWith({
            'src/api/foo/controllers/index.ts':
                'export type Evt = { a: 1 }\nexport interface Endpoints { x: { response: Evt } }\n',
            'src/api/foo/routes/custom.ts':
                "export default { routes: [{ method: 'GET', path: '/foo/x', handler: 'foo.x' }] }\n",
        })
        try {
            const { endpoints, extraTypes } =
                await service().extractRoutesFromFiles(root)
            expect(endpoints[0]?.types).toEqual({ response: 'Evt' })
            expect(extraTypes).toEqual([
                {
                    controller: 'index',
                    typeName: 'Evt',
                    typeDefinition: '{ a: 1; }',
                },
            ])
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })

    it('warns once about a controller that does not parse', async () => {
        const root = appWith({
            'src/api/bad/controllers/bad.ts': 'export interface Endpoints {\n',
        })
        const warnings: string[] = []
        try {
            const svc = service(warnings)
            await svc.extractExtraTypes(root)
            await svc.extractExtraTypes(root)
            expect(warnings).toHaveLength(1)
            expect(warnings[0]).toMatch(/bad\.ts has a syntax error/)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    })
})
