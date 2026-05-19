# Asgardeo B2C Sample App

This repository contains a sample B2C travel booking application secured with Asgardeo. The application demonstrates a travel experience where users can search for flights. Account management in this app is handled by WSO2 Identity Platform Cloud (Asgardeo). The AI agent sample demonstrates how the agent interactions can be made secure using Asgardeo's agentic AI security capabilities.

## Project Structure

```text
asgardeo-b2c-sample-app/
├── frontend/        React + Vite web application
├── api/             Node.js REST API
├── mcp/             TypeScript MCP server that wraps the REST API
├── ai-agent/        LangChain WebSocket agent with Asgardeo agent authentication
```

### Quick Setup

Run the API, frontend, MCP server and AI agent (in that order) in separate terminals as needed.

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

## Components

### Frontend

The `frontend/` app provides the travel booking UI and uses the [Asgardeo React SDK](https://www.npmjs.com/package/@asgardeo/react).

The frontend application

- Renders the flight booking experience
- Integrates with Asgardeo to handle sign in, sign up, and sign out
- Integrates with the Node.js REST API for data persistence

See `frontend/README.md` for setup and local run instructions.

### API

The `api/` app provides REST endpoints used by the frontend.

Features:

- List and search flight information
- Book flights

REST API documentation is available in:

```text
api/openapi.yaml
```

See `api/README.md` for setup, database seeding, and local run instructions.

### MCP Server

The `mcp/` app exposes the REST API as MCP tools for the AI agent.

Features:

- Wrap flight, location, booking, and profile API endpoints as MCP tools
- Serve MCP requests over Streamable HTTP at `/mcp`
- Forward the incoming `Authorization` header to the REST API

See `mcp/README.md` for setup, tools, and local run instructions.

### AI Agent

The `ai-agent/` app provides a sample AI agent that demonstrates authenticating AI agents with Asgardeo.

Features:

- Access MCP tools and API resources with AI agent's own identity using it's agent credentials
- Multi LLM provider support
- Websocket chat interface over `/chat` endpoint

See `ai-agent/README.md` for setup, environment variables, and local run instructions.

The API, MCP server, AI agent, and frontend dev commands all watch source files and reload on code changes.

Default local URLs:

```text
Frontend: http://localhost:5173
API:      http://localhost:8787
MCP:      http://localhost:8000/mcp
Agent:    ws://localhost:8790/chat
```
