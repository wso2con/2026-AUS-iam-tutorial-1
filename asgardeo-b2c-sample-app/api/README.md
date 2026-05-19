# Wayfinder Travel API

This application contains the REST API that provides flight listing, search and booking endpointsfor the Wayfinder Travel frontend.

## Configuration

### On Asgardeo

> These configurations are required only when the API Authorization is enabled in the REST API using
> `API_REQUIRE_AUTH=true`

1. Register this sample API as a business API resource:

- Sign in to the Asgardeo Console.
- Go to **Resources** > **API Resources**.
- Click **New API Resource**.
- Enter an identifier for the API resource. This is later configured in the registered Asgardeo application for the frontend application as one of the allowed audiences.
- Add the scopes listed below. Keep the scope values exactly as shown.

| Scope                       | Display Name               | Description                                                        |
| --------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `flights:write`             | Manage Flights             | Create, update, or manage flight-related records and operations.   |
| `bookings:read`             | View Bookings              | View and retrieve booking details and reservation information.     |
| `profile:read`              | View Profile               | Access and view user profile information.                          |
| `profile:write`             | Manage Profile             | Create or update user profile information and preferences.         |
| `deal-alert-consents:read`  | View Deal Alert Consents   | View user consent settings for deal and price alert notifications. |
| `deal-alert-consents:write` | Manage Deal Alert Consents | Create, update, or revoke deal alert consent preferences.          |
| `cds-profiles:read`         | View CDS Profiles          | Access and view CDS profile information and associated data.       |
| `cds-profiles:write`        | Manage CDS Profiles        | Create or modify CDS profile information and settings.             |

- Enable **Requires authorization**.
- Click **Create**.

2. Authorize the frontend application to request the API scopes:

- In Asgardeo console, go to **Applications**.
- Open the application created for the frontend.
- Go to the **Authorization** tab.
- Click **Authorize resource**.
- Select the Wayfinder API resource created in the above step.
- Select the scopes the frontend should be allowed to request, for example `bookings:read` and `bookings:write` for booking flows.
- Click **Finish**.

3. If RBAC (Role-based Access Control) is enabled, create or update roles so users can actually receive the authorized scopes:

- In the Asgardeo application for the frontend, go to the **Roles** tab and choose the role audience you want to use.
- Create an application role, or use organization roles if the app is configured for organization role audience.
- Add the required API permissions to the role.
- Assign users or groups to the role.
- Make sure the frontend login request includes the scopes required.

### On Your Machine

1. Create a local environment file from the `.env.example`:

```bash
cd api
cp .env.example .env
```

2. Install dependencies and start the API.

```bash
npm install
npm run seed # seed the database
npm run dev
```

`npm run dev` watches source files and restarts the API automatically. To rebuild the local SQLite database from scratch, run:

```bash
npm run seed --force
```

The API runs on:

```text
http://localhost:8787
```

## Endpoints

OpenAPI documentation is available in:

```text
openapi.yaml
```

## API Authorization

By default, `API_REQUIRE_AUTH=false` configuration is effective, so the frontend can call the sample API during local demos.

To require Asgardeo access tokens for protected endpoints. More details on configuring Asgardeo can be found in [configuration](#on-asgardeo)

```bash
API_REQUIRE_AUTH=true
ASGARDEO_BASE_URL=https://api.asgardeo.io/t/your-organization-name
ASGARDEO_AUDIENCE=your-wayfinder-api-resource-identifier
```

When enabled, protected routes require ```Authorization: Bearer <asgardeo-access-token>``` header in the incoming API requests, and the access tokens sent should have the issuer for the configured Asgardeo organization, include one of the configured audiences, and contain the route-specific permissions.