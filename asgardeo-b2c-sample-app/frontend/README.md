# Wayfinder Travel

Wayfinder Travel is a Vite + React sample web application secured with the Asgardeo React SDK. It demonstrates a travel booking experience, with access management powered by Asgardeo.

## Features

- Flight booking user interface
- Featured flight deals and hotel recommendations
- Sign in with Asgardeo
- Sign up with Asgardeo
- Sign out from the authenticated session

## Asgardeo Configuration

1. Sign into [Asgardeo Console](https://console.asgardeo.io).

2. Go to **Applications** > **New Application** and select **Single Page Application**.

3. Provide the required details.

- Name: a meaningful name for the frontend application.
- Authorized redirect URL: `http://localhost:5173`

## On Your Machine

1. Install dependencies.

```bash
npm install
```

2. Create a local `.env` file from `.env.example` and update the values according to your Asgardeo organization.

```bash
cp .env.example .env
```

3. Start the development server:

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
