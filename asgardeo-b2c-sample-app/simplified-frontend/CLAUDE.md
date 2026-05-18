# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server — currently runs on http://localhost:3000 (binds 0.0.0.0)
npm run build     # Production build
npm run preview   # Serve production build (binds 0.0.0.0)
```

There are no lint or test scripts.

## Environment Variables

A `.env` file exists. Variables:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend REST API URL (default: `http://localhost:8787`) |
| `VITE_AGENT_CHAT_URL` | WebSocket URL for AI chat agent (default: `ws://localhost:8790/chat`) |
| `VITE_WALLET_CREDENTIAL_OFFER` | Verifiable credential offer string for the profile page QR code |

## Purpose

**Wayfinder Travel** is a React 19 + Vite SPA used as a demo base for showing how to integrate the Asgardeo React SDK into an existing app. It is a travel booking UI with no authentication wired up — the intent is to live-demo adding auth step by step.

The planned demo additions are:
1. Wrap `main.jsx` with `AsgardeoProvider` and config
2. Add sign-in / sign-out buttons to `src/components/Header.jsx`
3. Add a profile icon to the header when signed in

The app has no backend code — the frontend calls a separate REST API (`VITE_API_BASE_URL`) and an optional WebSocket chat agent.

## Architecture

### Header

`src/components/Header.jsx` is intentionally minimal — brand logo, nav links, nothing else. This is the file to edit when demoing auth additions.

### Data fetching

`api.js` — plain fetch wrappers for all API endpoints (flights, hotels, trips, bookings, profile). No auth headers are sent.

`api-queries.js` — TanStack Query hooks built on `api.js`. All queries run unconditionally (no `isSignedIn` guards). Query cache is configured with `staleTime: 60s`, no auto-refetch.

### Pages and routing

Routes are defined in `App.jsx`'s `<AppRoutes>`. All routes are accessible without authentication. The catch-all redirects to `/flights`.

Search criteria flow through URL query params (`src/utils/routes.js` — `buildResultsPath` / `readCriteria`).

### AI chat widget

`ChatWidget` in `App.jsx` maintains a persistent WebSocket connection to `VITE_AGENT_CHAT_URL` with exponential backoff reconnection (700 ms → 4 s). Pages can trigger the deal-alert flow by dispatching a `wayfinder:deal-alert-consent` custom DOM event; the widget intercepts it, shows a criteria card, and sends the result to the agent.
