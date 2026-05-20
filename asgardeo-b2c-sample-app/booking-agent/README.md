# Booking Agent

The booking agent is a Python FastAPI service that powers the WayFinder AI
concierge. It accepts chat requests from the Assistant Widget, validates
Asgardeo user tokens, talks to the secured WayFinder MCP server, and uses
Asgardeo's on-behalf-of (OBO) authorization flow when the agent needs explicit
user consent to create bookings.

The service runs locally on `http://localhost:5001` by default.

## Asgardeo Configuration

Before running the agent, configure the following items in your Asgardeo
organization.

### 1. Register the frontend SPA

Create or reuse the single-page application used by the frontend.

1. Go to **Applications** > **New Application**.
2. Select **Single-Page Application**.
3. Add the frontend redirect URL used by this sample.
4. Copy the application's **Client ID**.

Use this value in:

```bash
TOKEN_AUDIENCE=<spa-application-client-id>
```

The same client ID should be configured in the frontend as
`VITE_ASGARDEO_CLIENT_ID`.

### 2. Register the booking agent

Create an AI agent identity for this service.

1. Go to **Agents** > **New Agent**.
2. Enter a name such as `WayFinder Booking Agent`.
3. Enable user login for the agent.
4. Select the interactive agent option.
5. Set the callback URL to:

```text
http://localhost:5001/api/obo/callback
```

6. Copy the generated **Agent ID** and **Agent Secret**.

Use these values as follows in .env:

```bash
AGENT_ID=<agent-id>
AGENT_SECRET=<agent-secret>
OBO_REDIRECT_URI=http://localhost:5001/api/obo/callback
```

### 3. Configure the agent OAuth application

The agent authenticates through the OAuth/OIDC application associated with the
agent/MCP client configuration.

Copy its client credentials into:

```bash
ASGARDEO_CLIENT_ID=<agent--application-client-id>
ASGARDEO_CLIENT_SECRET=<agent-or-mcp-client-application-client-secret>
```

Make sure the application allows the callback URL used by this service:

```text
http://localhost:5001/api/obo/callback
```

### 4. Configure scopes and API resource

Create or reuse the API resource used by the WayFinder MCP server. This sample
expects the resource identifier to be `booking_api` unless you change the
environment variables.

The default local scopes are:

```bash
AGENT_SCOPES="openid profile bookings:read"
OBO_SCOPES="openid profile bookings:read bookings:write"
OBO_RESOURCE=booking_api
```

Grant read scopes to the agent for basic MCP access. Grant write scopes to the
roles/users that should be allowed to create bookings through the OBO flow.

## Local Setup

### 1. Create the environment file

Copy the sample environment file and update the placeholders.

```bash
cp .env.example .env
```

Minimum required values:

```bash
ASGARDEO_BASE_URL=https://api.asgardeo.io/t/<organization-name>
ASGARDEO_CLIENT_ID=<agent-or-mcp-client-app-client-id>
ASGARDEO_CLIENT_SECRET=<agent-or-mcp-client-app-client-secret>
AGENT_ID=<agent-id>
AGENT_SECRET=<agent-secret>
TOKEN_AUDIENCE=<spa-application-client-id>
JWKS_URL=https://api.asgardeo.io/t/<organization-name>/oauth2/jwks
AUTH_ISSUER=https://api.asgardeo.io/t/<organization-name>/oauth2/token
OBO_REDIRECT_URI=http://localhost:5001/api/obo/callback
GOOGLE_API_KEY=<google-ai-studio-api-key>
MODEL_NAME=gemini-2.5-flash
WAYFINDER_MCP_SERVER_URL=http://localhost:8000/mcp
AGENT_SCOPES=openid profile bookings:read
OBO_SCOPES=openid profile bookings:read bookings:write
OBO_RESOURCE=booking_api
```

Do not commit `.env` files with real client secrets, agent secrets, or LLM API
keys.

### 2. Install Python dependencies

From the `booking-agent` directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Start the required local services

Start the WayFinder MCP server first. The booking agent expects it at:

```text
http://localhost:8000/mcp
```

Start the frontend with:

```bash
VITE_AGENT_API_BASE_URL=http://localhost:5001
```

### 4. Run the booking agent

```bash
python main.py
```

The service starts on:

```text
http://localhost:5001
```

You can override the bind host or port if needed:

```bash
AGENT_SERVER_HOST=127.0.0.1 AGENT_SERVER_PORT=5002 python main.py
```

## API Endpoints

- `POST /api/chat` - sends a user message to the AI booking agent.
- `GET /api/obo/url` - creates the Asgardeo authorization URL for OBO consent.
- `GET /api/obo/callback` - handles the Asgardeo OBO redirect.
- `GET /api/obo/status` - checks whether the current user has an active OBO token.
- `GET /api/obo/pending` - returns the message that triggered authorization.
- `POST /api/logout` - clears the user's in-memory agent session.

All API endpoints except the OBO callback expect:

```http
Authorization: Bearer <asgardeo-access-token>
```

## References

- [Asgardeo AI agent registration](https://wso2.com/asgardeo/docs/guides/agentic-ai/ai-agents/register-and-manage-agents/)
- [Asgardeo agent credentials](https://wso2.com/asgardeo/docs/guides/agentic-ai/ai-agents/agent-credentials/)
- [Asgardeo agent authentication](https://wso2.com/asgardeo/docs/guides/agentic-ai/ai-agents/agent-authentication/)
- [Asgardeo SPA registration](https://wso2.com/asgardeo/docs/guides/applications/register-single-page-app/)
