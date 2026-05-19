import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { hasBearerToken, resolveBearerUser } from "./auth.js";
import { findFlights, findHotels } from "./db.js";
import { logger } from "./logger.js";

export function getRoutePermissions(method, path) {
  if (path === "/health" || method === "OPTIONS") {
    return [];
  }

  if (isPublicSearchRead(method, path)) {
    return [];
  }

  if (path === "/api/flights" || path.startsWith("/api/flights/")) {
    return ["flights:write"];
  }

  if (path === "/api/me" || path === "/api/me/profile") {
    return method === "PATCH" ? ["profile:write"] : ["profile:read"];
  }

  if (path === "/api/bookings" || path.startsWith("/api/bookings/")) {
    return method === "GET" ? ["bookings:read"] : ["bookings:write"];
  }

  if (path === "/api/deal-alert-consents" || path.startsWith("/api/deal-alert-consents/")) {
    return method === "GET" ? ["deal-alert-consents:read"] : ["deal-alert-consents:write"];
  }

  if (path === "/api/cds/profiles") {
    return ["cds-profiles:write"];
  }

  if (path.startsWith("/api/cds/profiles/")) {
    return method === "GET" ? ["cds-profiles:read"] : ["cds-profiles:write"];
  }

  return [];
}

export function isPublicSearchRead(method, path) {
  return method === "GET" && (
    path === "/api/flights"
    || path.startsWith("/api/flights/")
    || path === "/api/hotels"
    || path === "/api/trips"
    || path === "/api/locations"
  );
}

export async function attachOptionalBearerUser(request, requestLogger) {
  if (!hasBearerToken(request)) {
    return;
  }

  try {
    const user = await resolveBearerUser(request);

    if (!user) {
      return;
    }

    request.authenticatedUser = user;
    requestLogger.info({
      userId: user.id,
      username: user.username,
      email: user.email
    }, "Optional bearer user resolved for public request");
  } catch (error) {
    requestLogger.warn({ err: error }, "Ignoring invalid optional bearer token for public request");
  }
}

export function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function sendJson(response, statusCode, body) {
  response.status(statusCode).json(body);
}

export async function readJsonBody(request) {
  return request.body || {};
}

export function getSearchParams(request) {
  return new URL(request.originalUrl, `http://${request.headers.host}`).searchParams;
}

export function searchFlights(params) {
  return findFlights({
    from: params.get("from"),
    to: params.get("to"),
    cabin: params.get("cabin")
  });
}

export function searchHotels(params) {
  return findHotels({
    location: params.get("location"),
    maxNightlyRate: Number(params.get("maxNightlyRate") || 0)
  });
}

export function generateBookingReference() {
  return randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

export function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value.trim();
}

export function normalizeOptionalTags(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  return [];
}

export function isAllowedPreference(value) {
  return ["any", "earlier", "later"].includes(value);
}

export function getBearerAccessToken(request: any) {
  const authHeader = request.headers.authorization || "";

  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export function getAsgardeoBaseUrl() {
  const baseUrl = process.env.ASGARDEO_BASE_URL;

  if (!baseUrl) {
    throw new Error("ASGARDEO_BASE_URL is required to update Asgardeo profiles");
  }

  return baseUrl.replace(/\/$/, "");
}

export async function getCDSToken() {
  const baseUrl = process.env.ASGARDEO_BASE_URL;
  const clientId = process.env.CDS_ASGARDEO_CLIENT_ID;
  const clientSecret = process.env.CDS_ASGARDEO_CLIENT_SECRET;

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error("Missing CDS credentials in environment");
  }

  const tokenEndpoint = `${baseUrl.replace(/\/$/, "")}/oauth2/token`;
  const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const scopes = (process.env.CC_SCOPES || "").replace(/^\s*"|"\s*$/g, "").trim();

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${encodedCredentials}`
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      ...(scopes && { scope: scopes })
    }).toString()
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Failed to get CDS token");
  }

  return data.access_token;
}

export function extractCookieValue(setCookieHeaders, cookieName) {
  for (const headerValue of setCookieHeaders) {
    const firstPart = String(headerValue || "").split(";")[0] || "";
    const eqIndex = firstPart.indexOf("=");

    if (eqIndex <= 0) {
      continue;
    }

    const name = firstPart.slice(0, eqIndex).trim();
    const value = firstPart.slice(eqIndex + 1).trim();

    if (name === cookieName) {
      return value;
    }
  }

  return null;
}

function getPrimaryScimEmail(scimUser: any) {
  const emailValue = scimUser?.email || scimUser?.mail;

  if (typeof emailValue === "string" && emailValue) {
    return emailValue;
  }

  if (!Array.isArray(scimUser?.emails)) {
    if (typeof scimUser?.emails === "string") {
      return scimUser.emails;
    }

    if (scimUser?.emails && typeof scimUser.emails === "object") {
      return scimUser.emails.value || scimUser.emails.display || "";
    }

    return "";
  }

  const primaryEmail = scimUser.emails.find((email: any) => email?.primary === true || email?.primary === "true");
  const firstEmail = primaryEmail || scimUser.emails[0];

  if (typeof firstEmail === "string") {
    return firstEmail;
  }

  return firstEmail?.value || firstEmail?.display || "";
}

function getScimNameValue(scimUser: any, fieldName: string, fallbackFieldNames: string[]) {
  const nameValue = scimUser?.name?.[fieldName];

  if (nameValue) {
    return nameValue;
  }

  for (const fallbackFieldName of fallbackFieldNames) {
    if (scimUser?.[fallbackFieldName]) {
      return scimUser[fallbackFieldName];
    }
  }

  return "";
}

export function mapScimProfile(scimUser: any) {
  return {
    firstName: getScimNameValue(scimUser, "givenName", ["given_name", "givenName"]),
    lastName: getScimNameValue(scimUser, "familyName", ["family_name", "familyName"]),
    username: scimUser?.userName || getPrimaryScimEmail(scimUser) || "",
    email: getPrimaryScimEmail(scimUser),
    memberSince: scimUser?.meta?.created || "",
    raw: scimUser
  };
}

export async function fetchAsgardeoMeProfile(accessToken: string) {
  const response = await fetch(`${getAsgardeoBaseUrl()}/scim2/Me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/scim+json, application/json"
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || data.description || data.error_description || data.error || "Failed to fetch Asgardeo profile");
  }

  return data;
}

export async function notifyAgentOfDealMatches(flight, matches) {
  if (!matches.length) {
    return;
  }

  const webhookUrl = process.env.AGENT_DEAL_ALERT_WEBHOOK_URL || "http://localhost:8790/deal-alerts";

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flight, matches })
    });

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      logger.warn({ statusCode: response.status, message }, "Deal alert webhook failed");
    }
  } catch (error) {
    logger.warn({ err: error }, "Deal alert webhook could not be reached");
  }
}
