# Wayfinder Travel API

REST API for the Wayfinder Travel frontend. It provides sample flight search, hotel search, saved trip, and booking endpoints for the React + Vite application.

## Run Locally

Create a local environment file:

```bash
cd api
cp .env.example .env
```

Start the API:

```bash
npm install
npm run seed
npm run dev
```

`npm run dev` watches source files and restarts the API automatically. To rebuild the local SQLite database from scratch, run:

```bash
npm run seed -- --force
```

The API runs on:

```text
http://localhost:8787
```

## Endpoints

```text
GET  /health
GET  /api/flights?from=Colombo&to=Singapore
POST /api/flights
DELETE /api/flights/:flightId
GET  /api/hotels?location=Singapore
GET  /api/trips
GET  /api/locations?category=flights
POST /api/bookings
GET  /api/bookings/flights
GET  /api/bookings/flights/:bookingId
PATCH /api/bookings/:bookingId/price
PATCH /api/bookings/:bookingId/cancel
POST /api/deal-alert-consents
POST /api/deal-alert-consents/transfer
GET  /api/deal-alert-consents/:username
GET  /api/me
GET  /api/me/profile
PATCH /api/me/profile
```

OpenAPI documentation is available in:

```text
openapi.yaml
```

`POST /api/bookings` accepts:

```json
{
  "type": "flight",
  "itemId": "flight-cmb-sin-01",
  "travelers": 2
}
```

`POST /api/flights` inserts a flight, checks enabled better-deal alert consents, and calls the configured agent webhook when criteria match:

```json
{
  "from": "Colombo",
  "to": "Singapore",
  "airline": "Serendib Air",
  "departureTime": "10:20",
  "arrivalTime": "16:30",
  "duration": "4h 10m",
  "stops": 0,
  "price": 250,
  "currency": "USD",
  "cabin": "Economy",
  "dates": "Jun 12 - Jun 18",
  "tags": ["Better deal"]
}
```

## API Authorization

By default, `API_REQUIRE_AUTH=false` so the frontend can call the sample API during local demos.
When auth is disabled but a request includes an Asgardeo bearer token, the API uses the token claims for booking ownership instead of the local demo user.

To require Asgardeo access tokens for protected endpoints:

```bash
API_REQUIRE_AUTH=true
ASGARDEO_BASE_URL=https://api.asgardeo.io/t/your-organization-name
ASGARDEO_AUDIENCE=your-wayfinder-api-resource-identifier
```

### Configure API authorization in Asgardeo Console

Register this sample API as a business API resource:

1. Sign in to the Asgardeo Console.
2. Go to **Resources** > **API Resources**.
3. Click **New API**.
4. Enter an identifier for the API resource. Use the same value as `ASGARDEO_AUDIENCE` because Asgardeo includes the API resource identifier in the access token `aud` claim.
5. Add the Wayfinder scopes listed below. Keep the scope values exactly as shown.
6. Enable **Requires authorization** if you want role-based authorization for these scopes.
7. Click **Finish**.

Authorize the frontend application to request the API scopes:

1. Go to **Applications**.
2. Open the B2C frontend application.
3. Go to the **API Authorization** tab.
4. Click **Authorize an API Resource**.
5. Select the Wayfinder API resource.
6. Select the scopes the frontend or agent should be allowed to request, for example `bookings:read` and `bookings:write` for booking flows.
7. Select the authorization policy. Use **Role-Based Access Control (RBAC)** when the API resource requires authorization.
8. Click **Finish**.

If RBAC is enabled, create or update roles so users can actually receive the authorized scopes:

1. In the application, go to the **Roles** tab and choose the role audience you want to use.
2. Create an application role, or use organization roles if the app is configured for organization role audience.
3. Add the required Wayfinder API permissions to the role.
4. Assign users or groups to the role.
5. Make sure the frontend login request includes the scopes required by the flow. The sample frontend currently requests booking scopes from `frontend/src/main.jsx`.

When enabled, protected routes require:

```text
Authorization: Bearer <asgardeo-access-token>
```

Search endpoints remain public and do not enforce scopes:

```text
GET  /api/flights
GET  /api/flights/:flightId
GET  /api/hotels
GET  /api/trips
GET  /api/locations
```

Protected endpoints:

```text
POST /api/flights
DELETE /api/flights/:flightId
POST /api/bookings
GET  /api/bookings/flights
GET  /api/me
GET  /api/me/profile
PATCH /api/me/profile
PATCH /api/bookings/:bookingId/price
PATCH /api/bookings/:bookingId/cancel
POST /api/deal-alert-consents
GET  /api/deal-alert-consents/:username
POST /api/deal-alert-consents/transfer
GET  /api/cds/profiles/:profileId
POST /api/cds/profiles
PATCH /api/cds/profiles/:profileId
```

When `API_REQUIRE_AUTH=true`, tokens must match `ASGARDEO_ISSUER` (or the default `${ASGARDEO_BASE_URL}/oauth2/token`), include one of the configured audiences, and include route-specific permissions in `scope`, `scp`, or `permissions`. The default permission names are:

```text
flights:write
bookings:read
profile:read
profile:write
deal-alert-consents:read
deal-alert-consents:write
cds-profiles:read
cds-profiles:write
```
