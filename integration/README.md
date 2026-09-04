# Paid Diagnosis local Worker integration

This setup runs Worker, D1, and Queue locally in workerd/Miniflare. It does not create or modify Cloudflare resources.

1. Copy `integration.env.example` to `access.local.env` and replace the token.
2. Use a persistence directory outside the static asset directory.
3. Apply local migrations and seed data:

```powershell
npx wrangler d1 migrations apply DB --local --config wrangler.integration.jsonc --persist-to ../madoha-integration-state
npx wrangler d1 execute DB --local --config wrangler.integration.jsonc --persist-to ../madoha-integration-state --file integration/seed.sql
```

4. Start the local Worker:

```powershell
npx wrangler dev --local --config wrangler.integration.jsonc --persist-to ../madoha-integration-state --env-file integration/access.local.env
```

The Stripe-free access and manual enqueue routes require both `ENVIRONMENT=integration` and `MADOHA_INTEGRATION_ACCESS_TOKEN`. They return 404 in production.
