# Moving to a different domain

Moving the product from one domain to another is DNS, environment variables and
auth callback configuration. It is not a code change, and CI enforces that: a
test fails the build if a domain literal appears anywhere in application code.

## What holds the domain

Everything reads from configuration, and none of it has a default:

| Variable | What depends on it |
|---|---|
| `PUBLIC_APP_URL` | absolute links in the app, email links, share URLs |
| `APP_DOMAIN` | display, cookie scope |
| `APP_NAME` | UI branding |
| `AUTH_CALLBACK_URL` | the OAuth redirect target |
| `STORAGE_PUBLIC_BASE` | how signed media URLs are addressed |

A missing value is a startup failure rather than a silent fallback, which is
what stops a half-migrated deployment from running and quietly serving the old
domain in half its links.

## Procedure

### 1. DNS and TLS

Point the new hostname at the same origin and issue a certificate. Keep the old
hostname resolving for now; nothing has moved yet.

### 2. Auth callbacks

In the auth provider, add the new callback URL **alongside** the old one. Adding
before switching means a user mid-login during the cutover completes rather than
landing on an error.

### 3. Storage

If storage is addressed through your own hostname (`STORAGE_PUBLIC_BASE`), add
the new host to the storage provider's allowed origins. Signed URLs are
generated per request, so previously issued URLs will expire naturally rather
than breaking.

### 4. Environment

Update the deployment's environment:

```bash
PUBLIC_APP_URL=https://<new-domain>
APP_DOMAIN=<new-domain>
AUTH_CALLBACK_URL=https://<new-domain>/auth/callback
STORAGE_PUBLIC_BASE=https://<new-domain>/media   # if self-addressed
```

Restart the web and API services. The GPU workers are unaffected: they never
know the public domain.

### 5. CORS

If the API is served from a different origin than the web app, add the new web
origin to its allowed origins before switching traffic, and remove the old one
after.

### 6. Smoke test on the new domain

- Sign in end to end, including the OAuth redirect.
- Open a project and confirm media loads (this exercises signed URLs).
- Start a generation and confirm progress updates arrive.
- Follow a link from an email and confirm it lands on the new host.

### 7. Retire the old domain

Once the new domain is verified, redirect the old hostname rather than removing
it. Old links exist in emails and in people's history, and a redirect costs
nothing. Remove the old auth callback only after the redirect is in place.

## Verifying portability

```bash
pnpm test:portability
```

This fails if a domain, GPU provider endpoint, bucket hostname or absolute model
path appears in application code. Documentation and `.env.example` are exempt,
because naming the value is their purpose.

If that test starts failing after a change, the fix is to read the value from
configuration, not to widen the exemption list.
