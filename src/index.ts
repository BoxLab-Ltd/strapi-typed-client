// Stub file — compiled to dist/index.js by `tsc`.
// When the user runs `npx strapi-types generate`, the generator overwrites
// dist/index.js (and .d.ts) with real, schema-aware code.
// Until then this stub provides importable symbols that throw at runtime
// with a helpful message explaining what to do.

const NOT_GENERATED_MESSAGE =
    '[strapi-typed-client] Types have not been generated yet.\n' +
    'Run: npx strapi-types generate --url <your-strapi-url>\n' +
    'Docs: https://github.com/BoxLab-Ltd/strapi-typed-client#quick-start'

export class StrapiError extends Error {
    userMessage: string
    status: number
    statusText: string
    details?: any

    constructor(
        message: string,
        userMessage: string,
        status: number,
        statusText: string,
        details?: any,
    ) {
        super(message)
        this.name = 'StrapiError'
        this.userMessage = userMessage
        this.status = status
        this.statusText = statusText
        this.details = details
    }
}

export class StrapiConnectionError extends Error {
    url: string
    cause?: Error

    constructor(message: string, url: string, cause?: Error) {
        super(message)
        this.name = 'StrapiConnectionError'
        this.url = url
        this.cause = cause
    }
}

export class StrapiClient {
    constructor(_config: { baseURL: string; token?: string }) {
        throw new Error(NOT_GENERATED_MESSAGE)
    }
}
