import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ts from 'typescript'
import { ParsedSchema } from '../schema-types.js'
import { TypesGenerator } from './types-generator.js'
import { ClientGenerator } from './client-generator.js'
import { IndexGenerator } from './index-generator.js'
import { ValidationGenerator } from './validation-generator.js'
import { resolveZod } from './zod-resolution.js'
import {
    VALIDATION_FILE_MARKER,
    isGeneratedValidationFile,
    isGeneratedTypesFile,
    GENERATED_TYPES_HEADER,
    SPLIT_TYPES_DIR,
    validationFileNames,
    type ValidationMode,
} from '../shared/client-header.js'
import type {
    ParsedEndpoint,
    ExtraControllerType,
} from '../shared/endpoint-types.js'
import type { AuthMode } from '../shared/strapi-schema-types.js'

function stripLocalJsExtensions(source: string): string {
    return source.replace(
        /(from\s+['"]|export\s+\*\s+from\s+['"])(\.[^'"]*)\.js(['"])/g,
        '$1$2$3',
    )
}

export interface GenerateOptions {
    endpoints?: ParsedEndpoint[]
    extraTypes?: ExtraControllerType[]
    schemaHash?: string
    generatorVersion?: string
    format?: 'js' | 'ts'
    typecheck?: boolean
    authMode?: AuthMode
    validation?: ValidationMode
    /** One file per collection and component category instead of a single types file. */
    splitTypes?: boolean
}

export class Generator {
    private outputDir: string
    private typesGenerator: TypesGenerator
    private clientGenerator: ClientGenerator
    private indexGenerator: IndexGenerator

    constructor(outputDir: string) {
        this.outputDir = outputDir
        this.typesGenerator = new TypesGenerator()
        this.clientGenerator = new ClientGenerator()
        this.indexGenerator = new IndexGenerator()
    }

    async generate(
        schema: ParsedSchema,
        {
            endpoints,
            extraTypes,
            schemaHash = '',
            generatorVersion = '',
            format = 'js',
            typecheck = true,
            authMode = 'legacy',
            validation = 'none',
            splitTypes = false,
        }: GenerateOptions = {},
    ): Promise<void> {
        // Fail before any work: a missing zod or a foreign validation file must
        // not leave a half-written tree
        this.assertValidationFilesAreOurs(validation)
        const zodDir =
            validation === 'zod' ? resolveZod(this.outputDir) : undefined
        const moduleOptions: ts.CompilerOptions = zodDir
            ? { paths: { zod: [zodDir] } }
            : {}

        // Generate all source contents
        const typesFiles = splitTypes
            ? this.typesGenerator.generateSplit(schema)
            : { 'types.ts': this.typesGenerator.generate(schema) }
        const clientContent = this.clientGenerator.generate(
            schema,
            endpoints,
            extraTypes,
            schemaHash,
            generatorVersion,
            authMode,
            validation,
        )
        const indexContent = this.indexGenerator.generate()

        // Format all files with prettier
        const files: Record<string, string> = {}
        for (const [name, content] of Object.entries(typesFiles)) {
            files[name] = await this.formatContent(content)
        }
        Object.assign(files, {
            'client.ts': await this.formatContent(clientContent),
            'index.ts': await this.formatContent(indexContent),
        })
        if (validation === 'zod') {
            files['validation.ts'] = await this.formatContent(
                new ValidationGenerator().generate(schema),
            )
        }

        if (format === 'ts') {
            // Write raw TypeScript for consumers that compile sources
            // themselves (monorepos). Strip `.js` extensions from local
            // relative imports first: tsc under moduleResolution "bundler"
            // accepts them (resolves .js → .ts), but Turbopack (Next 16)
            // doesn't, breaking `next build`.
            const strippedFiles = Object.fromEntries(
                Object.entries(files).map(([name, data]) => [
                    name,
                    stripLocalJsExtensions(data),
                ]),
            )
            // Type-check the exact bytes we're about to write, BEFORE touching
            // the consumer's tree — a guard throw must leave it untouched.
            this.verifyGeneratedTypes(strippedFiles, typecheck, moduleOptions)
            for (const [fileName, data] of Object.entries(strippedFiles)) {
                this.writeIfChanged(fileName, data)
            }
            this.removeStaleTypesFiles(Object.keys(strippedFiles))
        } else {
            // Compile all files together so cross-file imports resolve correctly
            const written = await this.compileFiles(
                files,
                typecheck,
                moduleOptions,
            )
            this.removeStaleTypesFiles(written)
        }

        this.removeStaleValidationFiles(format, validation)
    }

    private assertValidationFilesAreOurs(validation: ValidationMode): void {
        if (validation !== 'zod') return
        // The other format's name matters too: `./validation` would resolve to either
        for (const name of [
            ...validationFileNames('ts'),
            ...validationFileNames('js'),
        ]) {
            const file = path.join(this.outputDir, name)
            if (fs.existsSync(file) && !isGeneratedValidationFile(file)) {
                throw new Error(
                    `${file} was not generated by strapi-typed-client, so it will not be overwritten. Rename it or generate into another --output.`,
                )
            }
        }
    }

    // Covers turning validation off and switching format while it is on
    private removeStaleValidationFiles(
        format: 'js' | 'ts',
        validation: ValidationMode,
    ): void {
        const keep = new Set(
            validation === 'zod' ? validationFileNames(format) : [],
        )
        for (const name of [
            ...validationFileNames('ts'),
            ...validationFileNames('js'),
        ]) {
            if (keep.has(name)) continue
            const file = path.join(this.outputDir, name)
            if (fs.existsSync(file) && isGeneratedValidationFile(file)) {
                fs.rmSync(file)
            }
        }
    }

    // Skips identical content so an unchanged collection keeps its mtime — the
    // point of splitting is that a schema change touches only the files it affects
    private writeIfChanged(relPath: string, data: string): void {
        const file = path.join(this.outputDir, relPath)
        try {
            if (fs.readFileSync(file, 'utf-8') === data) return
        } catch {
            /* new file */
        }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, data, 'utf-8')
    }

    // Split output leaves files behind when a collection disappears or the mode
    // flips back to a single file. Only files carrying the generated header go,
    // so a consumer's own `base.ts` or `collections/` content survives.
    private removeStaleTypesFiles(written: string[]): void {
        const keep = new Set(written.map(f => path.normalize(f)))
        const candidates: string[] = []
        const walk = (dir: string): void => {
            let entries: fs.Dirent[]
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else candidates.push(path.relative(this.outputDir, full))
            }
        }
        walk(path.join(this.outputDir, SPLIT_TYPES_DIR))
        for (const ext of ['ts', 'js', 'd.ts']) candidates.push(`base.${ext}`)

        for (const rel of candidates) {
            if (!/\.(ts|js)$/.test(rel) || keep.has(path.normalize(rel))) {
                continue
            }
            const file = path.join(this.outputDir, rel)
            if (fs.existsSync(file) && isGeneratedTypesFile(file)) {
                fs.rmSync(file)
            }
        }
        // Drop directories the cleanup emptied
        const prune = (dir: string): void => {
            let entries: fs.Dirent[]
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                if (entry.isDirectory()) prune(path.join(dir, entry.name))
            }
            if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
        }
        prune(path.join(this.outputDir, SPLIT_TYPES_DIR))
    }

    private async formatContent(content: string): Promise<string> {
        try {
            const prettier = await import('prettier')
            return await prettier.format(content, {
                parser: 'typescript',
                semi: false,
                singleQuote: true,
                tabWidth: 2,
                trailingComma: 'es5',
                printWidth: 100,
            })
        } catch {
            return content
        }
    }

    private async compileFiles(
        files: Record<string, string>,
        typecheck: boolean,
        moduleOptions: ts.CompilerOptions,
    ): Promise<string[]> {
        const compilerOptions: ts.CompilerOptions = {
            ...moduleOptions,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
            declaration: true,
            esModuleInterop: true,
            skipLibCheck: true,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
        }

        const host = ts.createCompilerHost(compilerOptions)
        const fileNames = Object.keys(files)

        // Override file reading to serve in-memory files
        const originalGetSourceFile = host.getSourceFile
        host.getSourceFile = (
            fileName,
            languageVersion,
            onError,
            shouldCreateNewSourceFile,
        ) => {
            if (files[fileName]) {
                return ts.createSourceFile(
                    fileName,
                    files[fileName],
                    languageVersion,
                    true,
                )
            }
            return originalGetSourceFile(
                fileName,
                languageVersion,
                onError,
                shouldCreateNewSourceFile,
            )
        }

        const originalFileExists = host.fileExists
        host.fileExists = fileName => {
            if (files[fileName]) return true
            return originalFileExists(fileName)
        }

        // Capture emitted files
        const outputs: Record<string, string> = {}
        host.writeFile = (fileName: string, data: string) => {
            outputs[fileName] = data
        }

        // The `@ts-nocheck` header is gone, so the generated client must
        // type-check. Verify it the way a consumer's tsc would (on disk, where
        // bundler resolution maps the `.js` import specifiers to the sibling
        // `.ts`) and fail loudly rather than emit broken types into their tree.
        this.verifyGeneratedTypes(files, typecheck, moduleOptions)

        // Compile all files together
        const program = ts.createProgram(fileNames, compilerOptions, host)
        const emitted = program.emit()
        // Declaration emit can fail on its own (e.g. TS7056) after the type check passed
        if (emitted.diagnostics.length > 0) {
            throw new Error(
                `Failed to emit the generated client:\n${ts.formatDiagnostics(
                    emitted.diagnostics,
                    host,
                )}`,
            )
        }

        // Write output files
        for (const [fileName, data] of Object.entries(outputs)) {
            // tsc drops the leading comment from declarations; the marker is what
            // lets a later run recognise this file as ours
            let content = data
            if (fileName === 'validation.d.ts') {
                content = `${VALIDATION_FILE_MARKER}\n${data}`
            } else if (fileName.endsWith('.d.ts')) {
                const source = files[fileName.replace(/\.d\.ts$/, '.ts')]
                if (source?.includes(GENERATED_TYPES_HEADER)) {
                    content = `${GENERATED_TYPES_HEADER}\n${data}`
                }
            }
            this.writeIfChanged(fileName, content)
        }
        return Object.keys(outputs)
    }

    /**
     * Block on the generated client's type errors. Default throws — broken
     * types must never reach the consumer's tree; `--no-typecheck` downgrades
     * to a warning and writes anyway, so a strict-only false positive can't
     * wedge an upgrade with no recourse.
     */
    private verifyGeneratedTypes(
        files: Record<string, string>,
        typecheck: boolean,
        moduleOptions: ts.CompilerOptions,
    ): void {
        const message = this.collectTypeErrors(files, moduleOptions)
        if (!message) return
        if (typecheck) throw new Error(message)
        console.warn(`${message}\n(--no-typecheck set: writing anyway.)`)
    }

    /**
     * Type-check the generated client the way a consumer's tsc would and return
     * a formatted error message, or null if clean. Run from a temp dir on disk
     * so bundler resolution maps the `.js` import specifiers to the sibling
     * `.ts` files — the in-memory emit program can't resolve those, so it can't
     * double as the check. Strict + noUncheckedIndexedAccess is deliberately
     * stricter than a typical consumer tsconfig — the strict presets ship the
     * flag, and the emitted client must stay clean under them.
     */
    private collectTypeErrors(
        files: Record<string, string>,
        moduleOptions: ts.CompilerOptions,
    ): string | null {
        const checkDir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'strapi-types-check-'),
        )
        try {
            for (const [name, content] of Object.entries(files)) {
                const target = path.join(checkDir, name)
                fs.mkdirSync(path.dirname(target), { recursive: true })
                fs.writeFileSync(target, content, 'utf-8')
            }
            const rootNames = Object.keys(files).map(n =>
                path.join(checkDir, n),
            )
            const program = ts.createProgram(rootNames, {
                ...moduleOptions,
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ES2022,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                strict: true,
                noUncheckedIndexedAccess: true,
                skipLibCheck: true,
                noEmit: true,
            })
            const diagnostics = ts
                .getPreEmitDiagnostics(program)
                .filter(d => d.file && d.file.fileName.startsWith(checkDir))
            if (diagnostics.length === 0) return null

            const details = diagnostics
                .map(d => {
                    const msg = ts.flattenDiagnosticMessageText(
                        d.messageText,
                        '\n',
                    )
                    const loc =
                        d.file && d.start !== undefined
                            ? `${path.basename(d.file.fileName)}:${
                                  d.file.getLineAndCharacterOfPosition(d.start)
                                      .line + 1
                              } `
                            : ''
                    return `  ${loc}TS${d.code}: ${msg}`
                })
                .join('\n')
            return (
                `Generated client failed type-checking (${diagnostics.length} error(s)). ` +
                `This is a strapi-typed-client bug — please report it. ` +
                `If it's a false positive under your setup, bypass with --no-typecheck.\n${details}`
            )
        } finally {
            fs.rmSync(checkDir, { recursive: true, force: true })
        }
    }
}
