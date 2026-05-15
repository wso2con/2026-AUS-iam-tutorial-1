# SkyLink Lounge Access Demo (Next.js + Vercel)

Next.js demo app for the SkyLink lounge access story, backed by a Lissi-compatible OID4VP request-by-reference flow and DCQL request objects.

## What It Does

- Runs as a Next.js App Router app deployable to Vercel
- Creates lounge access requests and renders one QR
- Uses `openid4vp://?client_id=redirect_uri:<response-uri>&request_uri=<...>&request_uri_method=post`
- Serves a signed request-object JWT from request URI endpoint
- Accepts `direct_post` responses on global callback endpoint
- Verifies SD-JWT VC signature, disclosures, nonce binding, and required claims
- Tracks request lifecycle: `ACTIVE`, `VP_SUBMITTED`, `VERIFIED`, `FAILED`, `EXPIRED`

## API Endpoints

- `POST /api/sessions`
- `GET /openid4vp/authorization-request/:requestId`
- `POST /openid4vp/authorization-request/:requestId`
- `GET /openid4vp/authorization-request/:requestId/status`
- `POST /openid4vp/authorization-response`
- `GET /api/sessions/:sessionId`
- `GET /health`

`POST /api/sessions` creates a request from server configuration only. Send an empty JSON body:

```json
{}
```

Issuer, credential ID, VCT values, and requested claims are controlled by `.env` (`VERIFIER_ISSUER`, `REQUEST_DCQL_CREDENTIAL_ID`, `REQUEST_DCQL_VCT_VALUES`, `REQUEST_DCQL_CLAIMS`). Per-request overrides are rejected so the QR always reflects the configured use case.

## Request Object Shape

Signed JWT (`application/oauth-authz-req+jwt`) includes:

- `iss` = verifier issuer URL (`VERIFIER_ISSUER`)
- `aud` = `https://self-issued.me/v2` (configurable)
- `client_id` = `redirect_uri:<response-uri>`
- `response_type=vp_token`
- `response_mode=direct_post`
- `response_uri`
- `redirect_uri` (wallet return URL)
- `nonce`, `state`, `iat`, `exp`, `jti`
- optional `wallet_nonce` (when wallet uses `request_uri_method=post`)
- `dcql_query.credentials[0].meta.vct_values`
- `dcql_query.credentials[0].claims[]` with claim `id` + `path`
- `client_metadata` with branding fields and `vp_formats_supported` (`dc+sd-jwt` only)

## Quick Start

1. Install:

```bash
npm install
```

2. Configure env:

```bash
cp .env.example .env
```

3. Set `APP_BASE_URL` to public HTTPS (ngrok for local testing).

4. Run:

```bash
npm run dev -- -p 3001
```

5. Open:

```text
http://localhost:3001
```

## ngrok Flow

```bash
npm run dev -- -p 3001
ngrok http 3001
```

Then set `.env`:

```text
APP_BASE_URL=https://<your-subdomain>.ngrok-free.app
```

Restart app and create a new request.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Set every variable from `.env.example` in Project Settings -> Environment Variables.
3. Set `APP_BASE_URL` to the Vercel production URL, for example:

```text
APP_BASE_URL=https://your-app.vercel.app
VERIFIER_ISSUER=https://your-app.vercel.app
VERIFIER_REDIRECT_URI=https://your-app.vercel.app/lounge/complete
VERIFIER_REDIRECT_URIS=https://your-app.vercel.app/lounge/complete
```

4. Deploy with the default Vercel Next.js settings.

The demo uses an in-memory request store. That is acceptable for local demos and warm serverless invocations, but a production-grade Vercel deployment should replace it with durable storage such as Vercel KV because callbacks and polling can hit different serverless instances.

## Signing Config

- `REQUEST_SIGNING_PRIVATE_JWK` (required private JWK JSON)
- `REQUEST_SIGNING_KID` (optional, deterministic fallback from JWK thumbprint)
- `REQUEST_SIGNING_ALG` (optional, defaults from JWK type)
- `REQUEST_JWT_TTL_SECONDS`
- `LOG_RAW_VP_TOKEN` (`true` to log full incoming `vp_token` for debugging)

App fails fast on startup if signing JWK is missing or invalid.

## Lissi Payload Parity Config

- `VERIFIER_ISSUER`
- `VERIFIER_REDIRECT_URI`
- `REQUEST_AUDIENCE`
- `VERIFIER_CLIENT_NAME`
- `VERIFIER_LOGO_URI`
- `VERIFIER_POLICY_URI`
- `VERIFIER_CLIENT_URI`
- `VERIFIER_REDIRECT_URIS`
- `REQUEST_DCQL_CREDENTIAL_ID`
- `REQUEST_DCQL_VCT_VALUES`
- `REQUEST_DCQL_CLAIMS` (required JSON array of `{id,path}`)

## Trusted Issuer Keys

`TRUSTED_ISSUER_JWKS` accepts map:

```json
{
  "https://issuer.example": {
    "keys": [
      {
        "kty": "EC",
        "crv": "P-256",
        "x": "...",
        "y": "...",
        "kid": "issuer-key-1",
        "alg": "ES256"
      }
    ]
  }
}
```

If absent and `ALLOW_REMOTE_JWKS=true`, verifier tries issuer metadata `jwks_uri` and fallback `/.well-known/jwks.json`.

## Tests

```bash
npm test
```

## Wallet Interop Matrix

| Wallet | Status | Notes |
|---|---|---|
| Lissi | Pending manual run | DCQL + signed request JWT + redirect_uri + request_uri_method=post |
| Additional OID4VP wallet | Pending manual run | Same baseline flow |

## Scope

- Includes cryptographic and claim validation only
- Excludes revocation/status-list/trust-registry checks
- Baseline response mode is `direct_post`
