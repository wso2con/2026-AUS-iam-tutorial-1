# AI Agent

This folder contains a WebSocket-based AI agent sample that demonstrates Asgardeo agent authentication with LangChain.

The agent authenticates with Asgardeo using agent credentials, receives an agent access token, and uses that token to call a protected MCP server. The MCP tools are then exposed to a LangChain ReAct agent backed by Google Gemini, so clients can connect to the `/chat` WebSocket endpoint and let the agent call MCP tools on their behalf.

## What It Demonstrates

- Authenticating an AI agent with Asgardeo
- Requesting an agent token through `@asgardeo/javascript`
- Passing the agent token to an MCP server as a bearer token
- Loading MCP tools with `@langchain/mcp-adapters`
- Serving a `/chat` WebSocket endpoint for agent conversations

## Local Configuration

Install dependencies:

```bash
cd ai-agent
npm install
```

Create a local environment file from the example:

```bash
cp .env.example .env
```

Then update the values in `.env` for your local setup.

Environment variables:

- `CLIENT_ID`: Client ID of the Asgardeo application used by the agent flow.
- `ASGARDEO_BASE_URL`: Base URL of your Asgardeo organization.
- `AGENT_SCOPES`: Space-separated scopes requested for the agent's own token. Defaults to `openid profile deal-alert-consents:write`.
- `REDIRECT_URI`: Redirect URI configured for the Asgardeo application.
- `OBO_REDIRECT_URI`: Redirect URI used when the agent asks the user to authorize an on-behalf-of action. Defaults to `REDIRECT_URI` when omitted.
- `OBO_SCOPES`: Optional space-separated scopes requested for redirect-based on-behalf-of actions. Defaults to the scopes needed by the detected action.
- `AGENT_ID`: Agent identifier issued by Asgardeo.
- `AGENT_SECRET`: Agent secret issued by Asgardeo.
- `GOOGLE_API_KEY`: API key used by the Gemini chat model.
- `MODEL_NAME`: Optional Gemini model name. Defaults to `gemini-2.5-flash`.
- `MCP_SERVER_URL`: Optional MCP server endpoint. Defaults to `http://localhost:8000/mcp`.
- `AGENT_PORT`: Optional port for the WebSocket server. Defaults to `8790`.
- `HOST`: Optional host for the WebSocket server. Defaults to `localhost`.

## Run Locally

Start your MCP server first, then run the agent WebSocket server:

```bash
cd ai-agent
npm run dev
```

The dev command watches `agent.ts` and restarts the agent after code changes. Use `npm start` when you want a non-watching process.

The chat endpoint is available at:

```text
ws://localhost:8790/chat
```

The health endpoint is available at:

```text
http://localhost:8790/health
```

## Better-Deal Alert Flow

After a flight booking, the B2C frontend opens the agent widget and shows an embedded criteria picker for offline better-deal alerts. The frontend sends the booking, route, consent value, and criteria to the agent, and the agent calls the `store_deal_alert_consent` MCP tool.

When the API receives a new flight through `POST /api/flights`, it checks enabled deal-alert consents for matching routes and criteria. If there are matches, it calls the agent's `POST /deal-alerts` webhook. The agent invokes the `process_new_flight_deal_alerts` MCP tool, which starts CIBA flows for the matched users. The first user who approves gets the new flight booked and their previous booking canceled; the remaining pending polls are canceled.

## WebSocket Protocol

Connect to `/chat` and send either a plain text message:

```text
Add 45 and 99
```

Or a JSON payload:

```json
{
  "message": "Add 45 and 99"
}
```

The server responds with JSON messages. A successful agent reply has this shape:

```json
{
  "type": "response",
  "message": "144"
}
```

The server can also send:

- `ready`: Sent after the WebSocket connection is established.
- `processing`: Sent after a message is accepted and before the agent response is ready.
- `authorization_required`: Sent when a booking, profile, or user-booking request needs explicit user approval. The payload includes `authorizeUrl`, which the frontend opens in a new tab for Asgardeo consent.
- `error`: Sent when the message cannot be processed.

## Acting as Itself and On Behalf of the User

The better-deal monitoring flow uses the agent's own Asgardeo agent token to call protected MCP tools such as `store_deal_alert_consent`. The agent application must be authorized to request the Wayfinder API scope used by this tool, for example `deal-alert-consents:write`; otherwise the REST API can reject the forwarded token because the token audience does not include the Wayfinder API.

When the user asks the assistant to create a booking, read their flight bookings, or read their profile, the agent starts a redirect-based on-behalf-of flow instead of receiving a user token over the WebSocket. The authorize request includes `requested_actor=<AGENT_ID>`. After the user approves in Asgardeo, Asgardeo redirects to `OBO_REDIRECT_URI`; the agent exchanges the authorization code for a delegated access token and calls the relevant MCP tool with that token.

## Notes

- The MCP server must accept `Authorization: Bearer <agent-access-token>`.
- The WebSocket endpoint currently accepts text frames with either plain text or JSON payloads.
- The sample is intended for local demos and development. Do not commit real agent secrets, API keys, or local `.env` files.
