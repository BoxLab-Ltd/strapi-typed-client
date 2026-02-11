---
layout: home

hero:
    name: strapi-typed-client
    text: Type-Safe Strapi v5 Client
    tagline: Automatic TypeScript codegen with full type inference for your Strapi API. Stop writing types by hand.
    actions:
        - theme: brand
          text: Get Started
          link: /guide/getting-started
        - theme: alt
          text: GitHub
          link: https://github.com/BoxLab-Ltd/strapi-typed-client

features:
    - title: Type Generation
      details: Automatically generates TypeScript types from your Strapi schema. One command turns your content types, components, and relations into clean, strict TypeScript interfaces.
      icon: "\u2699\uFE0F"
    - title: Typed Client
      details: A fully typed fetch client with find, findOne, create, update, and delete methods for every collection. Full autocomplete, zero guesswork.
      icon: "\uD83D\uDD17"
    - title: Populate Inference
      details: TypeScript automatically infers the return type based on your populate parameter. Nested populate is supported too — what you ask for is what you get in the type.
      icon: "\uD83C\uDFAF"
    - title: Next.js Support
      details: First-class Next.js integration with withStrapiTypes config wrapper, automatic schema polling in dev, and built-in cache options for ISR and revalidation.
      icon: "\u25B2"
    - title: DynamicZone & Components
      details: Dynamic zones are generated as discriminated union types. Components are standalone interfaces. Everything composes naturally.
      icon: "\uD83E\uDDE9"
    - title: Input Types
      details: Separate input types for create and update operations. Relations accept IDs, media accepts IDs, and all fields are properly optional for partial updates.
      icon: "\u270F\uFE0F"
---
