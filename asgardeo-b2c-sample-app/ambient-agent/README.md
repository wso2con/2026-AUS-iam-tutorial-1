# Ambient Agent

This folder contains the Wayfinder ambient agent that demonstrates Asgardeo agent authentication.

The agent authenticates with Asgardeo using agent credentials, receives an agent access token, and uses that token to call a protected MCP server. It exposes one business webhook endpoint that is triggered whenever a new flight is added to the Wayfinder database.

## What It Demonstrates

- Authenticating an AI agent with Asgardeo
- Requesting an agent token through `@asgardeo/javascript`
- Passing the agent token to an MCP server as a bearer token
- Loading MCP tools with `@langchain/mcp-adapters`
- Receiving new-flight events through a webhook
- Comparing new flights against existing better-deal alert consents
- Using a LangGraph ReAct agent to write smart CIBA approval messages
- Starting CIBA approval flows for relevant users through the MCP server

## Local Configuration

Install dependencies:

```bash
cd ambient-agent
npm install
```

Create a local environment file from the example:

```bash
cp .env.example .env
```

Then update the values in `.env` for your local setup.

## Run Locally

Start your MCP server first, then run the AI agent:

```bash
cd ambient-agent
npm run dev
```

The dev command watches `agent.ts` and restarts the agent after code changes. Use `npm start` when you want a non-watching process.

The new-flight webhook endpoint is available at:

```text
http://localhost:8790/deal-alerts
```

The health endpoint is available at:

```text
http://localhost:8790/health
```

## Better-Deal Alert Flow

After a flight booking, the B2C frontend stores offline better-deal alert consent through the `store_deal_alert_consent` MCP tool.

When the API receives a new flight through `POST /api/flights`, it calls the ambient agent's `POST /deal-alerts` webhook with the new flight details. The agent fetches enabled deal-alert consent candidates, compares the new flight against their saved route and criteria, asks a LangGraph ReAct agent to write user-friendly CIBA binding messages, and invokes the `process_new_flight_deal_alerts` MCP tool for the relevant users. The first user who approves gets the new flight booked and their previous booking canceled; the remaining pending polls are canceled.

## Webhook Payload

Send a JSON payload with a `flight` object:

```json
{
  "flight": {
    "id": "flight-colombo-singapore-new",
    "from": "Colombo",
    "to": "Singapore",
    "airline": "WSO2 Air",
    "departureTime": "08:30",
    "arrivalTime": "14:30",
    "duration": "4h 30m",
    "stops": 0,
    "price": 320,
    "currency": "USD",
    "cabin": "Economy",
    "dates": "May 27"
  }
}
```

The server accepts the event immediately:

```json
{
  "status": "accepted",
  "flightId": "flight-colombo-singapore-new"
}
```

## Acting as Itself

The better-deal monitoring flow uses the agent's own Asgardeo agent token to call protected MCP tools such as `list_deal_alert_consents`. The agent application must be authorized to request the Wayfinder API scope used by this tool, for example `deal-alert-consents:read`; otherwise the REST API can reject the forwarded token because the token audience does not include the Wayfinder API.

## Notes

- The MCP server must accept `Authorization: Bearer <agent-access-token>`.
- The sample is intended for local demos and development. Do not commit real agent secrets, API keys, or local `.env` files.
