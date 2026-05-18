# Wayfinder Travel

Wayfinder Travel is a Vite + React sample web application secured with the Asgardeo React SDK. It demonstrates a travel booking experience similar in purpose to flight and hotel search platforms, with account actions powered by Asgardeo.

## Features

- Flight, hotel, and trip planning interface
- Search panel for route, dates, and traveler details
- Featured flight deals and hotel recommendations
- Sign in with Asgardeo
- Sign up with Asgardeo
- Sign out from the authenticated session
- Environment-based Asgardeo configuration

## Asgardeo Configuration

Create an application in Asgardeo and configure it as a Single Page Application.

Required application settings:

- Authorized redirect URL: `http://localhost:5173`
- Allowed origin: `http://localhost:5173`
- Sign-in method and user registration enabled as needed for your organization

Then create a local `.env` file from the example:

```bash
cp .env.example .env
```

Update the values:

```bash
VITE_ASGARDEO_CLIENT_ID=your-asgardeo-application-client-id
VITE_ASGARDEO_ORG_NAME=your-organization-name
VITE_ASGARDEO_BASE_URL=https://api.asgardeo.io/t/your-organization-name
VITE_API_BASE_URL=http://localhost:8787
```

`VITE_ASGARDEO_CLIENT_ID` is the client ID of your Asgardeo application.

`VITE_ASGARDEO_ORG_NAME` is used to build the sign-up URL. If omitted, the app derives it from `VITE_ASGARDEO_BASE_URL`.

`VITE_ASGARDEO_BASE_URL` is your Asgardeo organization base URL.

`VITE_API_BASE_URL` is the local URL of the REST API in the `api/` folder.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the app at:

```text
http://localhost:5173/
```

## Build

Create a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```
