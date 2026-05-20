import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AsgardeoProvider } from "@asgardeo/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";

const clientId = import.meta.env.VITE_ASGARDEO_CLIENT_ID;
const baseUrl = import.meta.env.VITE_ASGARDEO_BASE_URL;
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const requestedScopes = ["bookings:read", "bookings:write", "deal-alert-consents:write"];
const asgardeoReady = Boolean(clientId && baseUrl);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 60_000
    },
    mutations: {
      retry: false
    }
  }
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {asgardeoReady ? (
          <AsgardeoProvider
            allowedExternalUrls={[apiBaseUrl]}
            clientId={clientId}
            baseUrl={baseUrl}
            scopes={requestedScopes}
          >
            <App authReady />
          </AsgardeoProvider>
        ) : (
          <App authReady={false} />
        )}
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
