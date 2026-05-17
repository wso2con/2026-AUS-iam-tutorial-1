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
