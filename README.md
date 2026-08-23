This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Product compare

Store price comparison lives at `/compare` (API: `POST /api/compare-product`).

- **Architecture & legacy code:** [src/lib/product/LEGACY.md](src/lib/product/LEGACY.md)
- **Discovery:** Google Shopping via `SERPER_API_KEY` and/or `SERPAPI_API_KEY` (see `.env.example`)
- **Demo mode (synthetic only):** `PRODUCT_COMPARE_DEMO_MODE=true` — never for public production
- **OpenAI enrichment (opt-in):** requires `OPENAI_ENRICHMENT_ENABLED=true` **and** `OPENAI_API_KEY`
- **Deployment checklist:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Verbose compare logs / debug traces (default off):** `DEBUG_COMPARE=true` — leave unset or `false` in production

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before linking a project or sharing a public URL. Do not enable OpenAI enrichment or demo mode on the first protected launch.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
