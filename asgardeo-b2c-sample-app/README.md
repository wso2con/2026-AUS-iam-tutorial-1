# Asgardeo B2C Sample App

This repository contains a sample B2C travel booking application secured with Asgardeo. It is split into a React + Vite frontend, a Node.js REST API backed by SQLite, a TypeScript MCP server, and a WebSocket AI agent sample.

The application demonstrates a travel experience where users can search for flights and hotels, view trip ideas, and use Asgardeo-powered account actions such as sign in, sign up, and sign out. The MCP server wraps the travel REST API as tools. The AI agent sample demonstrates how an agent can authenticate with Asgardeo, receive an agent token, and use that token to call protected MCP tools through LangChain over a `/chat` WebSocket endpoint.

## Project Structure

```text
asgardeo-b2c-sample-app/
├── frontend/        React + Vite web application
├── api/             Node.js REST API
├── mcp/             TypeScript MCP server that wraps the REST API
├── ai-agent/        LangChain WebSocket agent with Asgardeo agent authentication
├── e2e/             Playwright end-to-end test suite
└── README.md        Project overview
```

## Frontend

The `frontend/` app provides the travel booking UI and integrates with the Asgardeo React SDK.

Main responsibilities:

- Render the flight, hotel, and trip planning experience
- Handle sign in, sign up, and sign out with Asgardeo
- Read Asgardeo configuration from environment variables
- Call the backend API for travel data

See `frontend/README.md` for setup and local run instructions.

## API

The `api/` app provides REST endpoints used by the frontend.

Main responsibilities:

- Serve flight search data
- Serve hotel search data
- Serve saved trip data
- Create sample bookings
- Optionally validate Asgardeo bearer tokens for protected endpoints
- Store seed data in a local SQLite database

API documentation is available in:

```text
api/openapi.yaml
```

See `api/README.md` for setup, database seeding, and local run instructions.

## MCP Server

The `mcp/` app exposes the REST API as MCP tools for the AI agent.

Main responsibilities:

- Wrap flight, hotel, trip, location, booking, and profile endpoints as MCP tools
- Serve MCP requests over Streamable HTTP at `/mcp`
- Forward the incoming `Authorization` header to the REST API
- Provide a local health endpoint

See `mcp/README.md` for setup, tools, and local run instructions.

## AI Agent

The `ai-agent/` app provides a local WebSocket sample for authenticating AI agents with Asgardeo.

Main responsibilities:

- Request an Asgardeo agent token using agent credentials
- Connect to an MCP server with the agent token as a bearer token
- Load MCP tools into a LangChain ReAct agent
- Use Google Gemini as the chat model
- Serve chat requests over `ws://localhost:8790/chat`

See `ai-agent/README.md` for setup, environment variables, and local run instructions.

## Local Development

Run the API, frontend, and AI agent in separate terminals as needed.

API:

```bash
cd api
npm install
npm run seed
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

MCP server:

```bash
cd mcp
npm install
npm run dev
```

AI agent:

```bash
cd ai-agent
npm install
npm run dev
```

The API, MCP server, AI agent, and frontend dev commands all watch source files and reload on code changes.

Default local URLs:

```text
Frontend: http://localhost:5173
API:      http://localhost:8787
MCP:      http://localhost:8000/mcp
Agent:    ws://localhost:8790/chat
```

## End-to-End Tests

The root `e2e/` suite uses Playwright to test the B2C sample app flows. The Playwright config starts the frontend dev server automatically and enables E2E-only mocks for Asgardeo auth and backend API calls, so you do not need to start the API separately for this suite.

Install dependencies from the B2C app root:

```bash
npm install
npm --prefix frontend install
```

Install the Playwright Chromium browser once:

```bash
npx playwright install chromium
```

Run the E2E suite:

```bash
npm run test:e2e
```

Run the suite in Playwright UI mode:

```bash
npm run test:e2e:ui
```

## Asgardeo Setup

### Register WayFinder Application in Asgardeo

If you have not already done so, create an organization in Asgardeo before registering an application.

- Sign up for an Asgardeo account.
- Sign into Asgardeo console and navigate to Applications > New Application.
- Provide the name as `WayFinder`.
- Add the following as the authorized redirect URL.

   ```
   http://localhost:5173
   ```
 - Click on the **Create** button.
 - Once the application is created, go to the protocol tab.
 - Configure the following under Allowed origins.

   ```
   http://localhost:5173
   ```
 - Documentation: https://wso2.com/asgardeo/docs/guides/applications/register-single-page-app/

Configure the frontend environment using the values from your Asgardeo application:

```bash
VITE_ASGARDEO_CLIENT_ID=your-asgardeo-application-client-id
VITE_ASGARDEO_ORG_NAME=your-organization-name
VITE_ASGARDEO_BASE_URL=https://api.asgardeo.io/t/your-organization-name
```

### Configure M2M Application for Customer Data Service Profile Management

- Navigate to Applications > New Application.
- Select M2M application template.
- Provide the name as `CDS M2M App`.
- Navigate to the **Authorize** tab of the created application.
- Configure the following APIs with relevant scopes.

| API | Scopes |
|-----|--------|
| Customer Data Service profile management API | Profile create, Profile view, Profile delete, Profile update |
| Customer Data Service config management API | Customer data service configuration view, Customer data service configuration update |

- Navigate to the **Protocol** tab.
- Under Access Token configuration, change Token type to `JWT`.
- Add `iam-cds` as an Audience.
- Note the client id and client secret of the application.
- Click on the **Update** button.

Configure the application's api/.env using the values from your M2M application:

```bash
CDS_ASGARDEO_CLIENT_ID=your-cds-m2m-client-id
CDS_ASGARDEO_CLIENT_SECRET=your-cds-m2m-client-secret
CC_SCOPES=internal_cds_profile_create internal_cds_profile_update internal_cds_profile_view internal_cds_profile_schema_view
```

Invoke the following cURL command to register the created M2M application as a system application which can view all application related data from profiles.

1. Obtain an access token using client credential grant type from the sample application.

```
curl --location 'https://api.asgardeo.io/t/<your-organization-name>/oauth2/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--header 'Authorization: Basic <base 64 encoded application clientId:clientSecret>' \
--data-urlencode 'grant_type=client_credentials' \
--data-urlencode 'scope=internal_cds_admin_config_update internal_cds_admin_config_view'
```

2. Update the customer data service configuration by adding the created M2M application as a system application.

```
curl --location --request PATCH 'https://api.asgardeo.io/t/<your-organization-name>/cds/api/v1/config' \
--header 'Authorization: Bearer <Obtained access token from the above step>' \
--data '{
        "cds_enabled": true,
        "system_applications" :[
            "CONSOLE", "<M2M application's client ID>"
        ]
}'
```

The API can run without token validation for local demos. To require Asgardeo access tokens for protected endpoints, enable the API auth settings in `api/.env`.

For the AI agent, configure the Asgardeo application details, agent credentials, Gemini API key, and MCP server URL in the `.env` file described in `ai-agent/README.md`.
