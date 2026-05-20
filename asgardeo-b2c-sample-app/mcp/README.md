# Travel MCP Server

A simple TypeScript MCP server that wraps the Wayfinder Travel REST API.

The AI agent connects to this server over Streamable HTTP at `/mcp`. The MCP server exposes travel API capabilities as tools, including flight search, bookings, locations, and profile lookup.

## Tools

- `search_flights`: Calls `GET /api/flights`.
- `search_hotels`: Calls `GET /api/hotels`.
- `get_trips`: Calls `GET /api/trips`.
- `get_locations`: Calls `GET /api/locations`.
- `create_booking`: Calls `POST /api/bookings`.
- `get_flight_bookings`: Calls `GET /api/bookings/flights`.
- `get_profile`: Calls `GET /api/me`.
- `store_deal_alert_consent`: Calls `POST /api/deal-alert-consents`.
- `list_deal_alert_consents`: Calls `GET /api/deal-alert-consents` so the ambient agent can compare new flights with enabled consent candidates.

## Local Configuration

Create a local environment file from the example:

```bash
cp .env.example .env
```

Then update the values in `.env` for your local setup.

## Run Locally

Install dependencies:

```bash
cd mcp
npm install
```

Start the MCP server:

```bash
npm run dev
```

The `dev` command watches `server.ts` and restarts the MCP server after code changes. Use `npm start` when you want a non-watching process.

The MCP endpoint is available at:

```text
http://localhost:8000/mcp
```

The health endpoint is available at:

```text
http://localhost:8000/health
```

## Authorization

If a client sends an `Authorization` header to the MCP endpoint, the MCP server forwards that header to the REST API. This allows protected API endpoints to receive the same bearer token provided by the AI agent.
