import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import "dotenv/config";
import express from "express";
import { AuthError, authorizeRequest } from "./auth.js";
import { logger } from "./logger.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerCDSRoutes } from "./routes/cds.js";
import { registerDealAlertRoutes } from "./routes/deal-alerts.js";
import { registerFlightRoutes } from "./routes/flights.js";
import { registerHotelRoutes } from "./routes/hotels.js";
import { registerLocationRoutes } from "./routes/locations.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerTripRoutes } from "./routes/trips.js";
import {
  asyncHandler,
  attachOptionalBearerUser,
  getRoutePermissions,
  isPublicSearchRead,
  sendJson
} from "./utils.js";

const port = Number(process.env.PORT || 8787);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const app = express();

function decodeBase64UrlJson(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function getBearerTokenPayload(request: any): Record<string, unknown> | null {
  const authorization = request.headers.authorization;
  const authHeader = Array.isArray(authorization) ? authorization[0] : authorization;

  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const [, payload] = token.split(".");

  if (!payload) {
    return null;
  }

  try {
    const decodedPayload = decodeBase64UrlJson(payload);

    return decodedPayload && typeof decodedPayload === "object"
      ? decodedPayload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getRequestTokenLogContext(request: any) {
  const rawClaims = getBearerTokenPayload(request);

  if (!rawClaims || typeof rawClaims !== "object") {
    return {};
  }

  const actorClaim = rawClaims.act;
  const actorSub = actorClaim && typeof actorClaim === "object"
    ? (actorClaim as Record<string, unknown>).sub
    : undefined;

  return {
    sub: typeof rawClaims.sub === "string" ? rawClaims.sub : undefined,
    actor: typeof actorSub === "string" ? actorSub : undefined
  };
}

app.use((request: any, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", frontendOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Wayfinder-User-Id,X-Wayfinder-Username,X-Wayfinder-Email"
  );

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: "1mb" }));

app.use((request: any, response, next) => {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const requestLogger = logger.child({
    requestId,
    method: request.method,
    path: request.path,
    ...getRequestTokenLogContext(request)
  });

  request.log = requestLogger;
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    requestLogger.info({
      statusCode: response.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(1))
    }, "HTTP request completed");
  });
  requestLogger.info({ query: request.query }, "HTTP request started");

  next();
});

app.use(asyncHandler(async (request: any, _response, next) => {
  const requiredPermissions = getRoutePermissions(request.method, request.path);

  if (requiredPermissions.length > 0) {
    request.authenticatedUser = await authorizeRequest(request, requiredPermissions);
  } else if (isPublicSearchRead(request.method, request.path)) {
    await attachOptionalBearerUser(request, request.log);
  }

  next();
}));

app.get("/health", (_request, response) => {
  sendJson(response, 200, { status: "ok" });
});

registerFlightRoutes(app);
registerHotelRoutes(app);
registerLocationRoutes(app);
registerTripRoutes(app);
registerMeRoutes(app);
registerBookingRoutes(app);
registerDealAlertRoutes(app);
registerCDSRoutes(app);

app.use((_request, response) => {
  sendJson(response, 404, { error: "Route not found" });
});

app.use((error, request: any, response, _next) => {
  const statusCode = error instanceof AuthError
    ? error.statusCode
    : error.message?.toLowerCase().includes("token")
      ? 401
      : 500;

  request.log?.error({ err: error, statusCode }, "HTTP request failed");

  sendJson(response, statusCode, {
    error: error.message
  });
});

app.listen(port, () => {
  logger.info({ port }, `Wayfinder Travel API listening on http://localhost:${port}`);
});
