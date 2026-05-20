/*
Copyright (c) 2026, WSO2 LLC. (http://www.wso2.com). All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getDurationMs, getLogPath, getStartTime, logger, logToolOperation, type Logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath: string) {
    if (!existsSync(filePath)) {
        return;
    }

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmedLine.indexOf("=");

        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^\s*["']|["']\s*$/g, "");

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadEnvFile(resolve(__dirname, ".env"));

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:8787";
const port = Number(process.env.PORT || process.env.MCP_PORT || 8000);
const host = process.env.HOST || "localhost";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function decodeBase64UrlJson(value: string) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
}

function getBearerTokenClaims(authorization: string | undefined) {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const parts = token.split(".");

    if (parts.length !== 3) {
        return null;
    }

    try {
        const payload = decodeBase64UrlJson(parts[1]);

        return {
            audience: payload.aud,
            issuer: payload.iss,
            permissions: payload.permissions,
            roles: payload.roles,
            scope: payload.scope,
            scp: payload.scp,
            subject: payload.sub,
        };
    } catch {
        return null;
    }
}

function getAuthorizationHeader(request: IncomingMessage): string | undefined {
    const authorization = request.headers.authorization;

    return Array.isArray(authorization) ? authorization[0] : authorization;
}

class InsufficientScopeError extends Error {
    constructor() {
        super("insufficient_scope");
        this.name = "InsufficientScopeError";
    }
}

function withScopeCheck<T extends Record<string, unknown>, R>(fn: (params: T) => Promise<R>) {
    return async (params: T): Promise<R | { isError: true; content: [{ type: "text"; text: string }] }> => {
        try {
            return await fn(params);
        } catch (error) {
            if (error instanceof InsufficientScopeError) {
                return {
                    isError: true as const,
                    content: [{ type: "text" as const, text: "insufficient_scope" }],
                };
            }

            throw error;
        }
    };
}

function createApiClient(authorization?: string, requestLogger: Logger = logger) {
    async function requestApi(path: string, options: RequestInit = {}): Promise<JsonValue> {
        const startedAt = getStartTime();
        const method = options.method || "GET";
        const headers = new Headers(options.headers);
        const apiLogger = requestLogger.child({
            upstream: "travel-api",
            upstreamMethod: method,
            upstreamPath: getLogPath(path, apiBaseUrl),
        });

        headers.set("Accept", "application/json");

        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }

        if (authorization) {
            headers.set("Authorization", authorization);
        }

        apiLogger.info({
            hasAuthorization: headers.has("Authorization"),
        }, "API request started");

        const response = await fetch(`${apiBaseUrl}${path}`, {
            ...options,
            headers,
        });

        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json")
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            apiLogger.warn({
                statusCode: response.status,
                durationMs: getDurationMs(startedAt),
            }, "API request failed");

            if (response.status === 403) {
                throw new InsufficientScopeError();
            }

            throw new Error(`API request failed with ${response.status}: ${JSON.stringify(body)}`);
        }

        apiLogger.info({
            statusCode: response.status,
            durationMs: getDurationMs(startedAt),
        }, "API request completed");

        return body as JsonValue;
    }

    return {
        get: (path: string) => requestApi(path),
        post: (path: string, body: JsonValue) => requestApi(path, {
            method: "POST",
            body: JSON.stringify(body),
        }),
        postWithBearer: (
            path: string,
            body: JsonValue,
            bearerToken: string,
            userHeaders?: Record<string, string>,
        ) => requestApi(path, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${bearerToken}`,
                ...(userHeaders ?? {}),
            },
            body: JSON.stringify(body),
        }),
        patch: (
            path: string,
            body: JsonValue,
            bearerToken?: string,
            userHeaders?: Record<string, string>,
        ) => {
            const headers = bearerToken ? {
                Authorization: `Bearer ${bearerToken}`,
                ...(userHeaders ?? {}),
            } : userHeaders;

            return requestApi(path, {
                method: "PATCH",
                headers,
                body: JSON.stringify(body),
            });
        },
    };
}

function toToolContent(data: JsonValue) {
    return {
        content: [
            {
                type: "text" as const,
                text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
        ],
    };
}

function createTravelMcpServer(authorization?: string, requestLogger: Logger = logger) {
    const api = createApiClient(authorization, requestLogger);
    const server = new McpServer({
        name: "wayfinder-travel-api",
        version: "1.0.0",
    });

    server.tool(
        "search_flights",
        "Search available flights from the travel API.",
        {
            from: z.string().optional().describe("Departure location, for example Colombo."),
            to: z.string().optional().describe("Arrival location, for example Singapore."),
        },
        withScopeCheck(async ({ from, to }) => logToolOperation(requestLogger, "search_flights", { from, to }, async () => {
            const params = new URLSearchParams();

            if (from) {
                params.set("from", from);
            }

            if (to) {
                params.set("to", to);
            }

            const query = params.toString();

            return toToolContent(await api.get(`/api/flights${query ? `?${query}` : ""}`));
        }),
    ));

    server.tool(
        "search_hotels",
        "Search available hotels from the travel API.",
        {
            location: z.string().optional().describe("Hotel location, for example Singapore."),
        },
        withScopeCheck(async ({ location }) => logToolOperation(requestLogger, "search_hotels", { location }, async () => {
            const params = new URLSearchParams();

            if (location) {
                params.set("location", location);
            }

            const query = params.toString();

            return toToolContent(await api.get(`/api/hotels${query ? `?${query}` : ""}`));
        }),
    ));

    server.tool(
        "get_trips",
        "Get saved trip ideas from the travel API.",
        {},
        withScopeCheck(async () => logToolOperation(requestLogger, "get_trips", {}, async () => (
            toToolContent(await api.get("/api/trips"))
        ))),
    );

    server.tool(
        "get_locations",
        "Get available travel locations from the travel API.",
        {
            category: z.enum(["flights", "hotels"]).optional().describe("Optional location category."),
        },
        withScopeCheck(async ({ category }) => logToolOperation(requestLogger, "get_locations", { category }, async () => {
            const query = category ? `?${new URLSearchParams({ category }).toString()}` : "";

            return toToolContent(await api.get(`/api/locations${query}`));
        })),
    );

    server.tool(
        "create_booking",
        "Create a sample booking in the travel API.",
        {
            type: z.enum(["flight", "hotel"]).describe("Booking type."),
            itemId: z.string().describe("Flight or hotel item ID to book."),
            travelers: z.number().int().optional().describe("Number of travelers."),
        },
        withScopeCheck(async ({ type, itemId, travelers }) => logToolOperation(
            requestLogger,
            "create_booking",
            { type, itemId, travelers },
            async () => toToolContent(await api.post("/api/bookings", {
                type,
                itemId,
                travelers: travelers ?? 1,
            })),
        )),
    );

    server.tool(
        "get_flight_bookings",
        "Get flight bookings for the current authenticated user.",
        {},
        withScopeCheck(async () => logToolOperation(requestLogger, "get_flight_bookings", {}, async () => (
            toToolContent(await api.get("/api/bookings/flights"))
        ))),
    );

    // server.tool(
    //     "get_profile",
    //     "Get the current authenticated user's profile from the travel API.",
    //     {},
    //     withScopeCheck(async () => logToolOperation(requestLogger, "get_profile", {}, async () => (
    //         toToolContent(await api.get("/api/me"))
    //     ))),
    // );

    server.tool(
        "store_deal_alert_consent",
        "Store whether a user consented to offline better-deal alerts for a flight booking.",
        {
            bookingId: z.string().describe("The confirmed flight booking ID."),
            username: z.string().describe("The username on the booking."),
            routeFrom: z.string().describe("Flight origin city."),
            routeTo: z.string().describe("Flight destination city."),
            criteria: z.object({
                minimumSavingsPercent: z.number().min(0).max(95).optional(),
                maxStops: z.number().int().min(0).nullable().optional(),
                timePreference: z.enum(["any", "earlier", "later"]).optional().describe("Preferred departure time on the same travel date."),
                datePreference: z.enum(["any", "earlier", "later"]).optional().describe("Deprecated. Use timePreference."),
                sameCabinOnly: z.boolean().optional(),
            }).optional().describe("User-selected criteria for matching future better deals."),
            minimumSavingsPercent: z.number().min(0).max(95).optional(),
            maxStops: z.number().int().min(0).nullable().optional(),
            timePreference: z.enum(["any", "earlier", "later"]).optional().describe("any, earlier, or later departure time on the same travel date."),
            datePreference: z.enum(["any", "earlier", "later"]).optional().describe("Deprecated. Use timePreference."),
            sameCabinOnly: z.boolean().optional(),
            enabled: z.boolean().describe("true when the user agrees to alerts, false when they decline."),
        },
        withScopeCheck(async ({
            bookingId,
            username,
            routeFrom,
            routeTo,
            criteria,
            minimumSavingsPercent,
            maxStops,
            timePreference,
            datePreference,
            sameCabinOnly,
            enabled,
        }) => logToolOperation(
            requestLogger,
            "store_deal_alert_consent",
            { bookingId, username, routeFrom, routeTo, criteria, enabled },
            async () => toToolContent(await api.post(
                "/api/deal-alert-consents",
                {
                    bookingId,
                    username,
                    routeFrom,
                    routeTo,
                    criteria: {
                        ...(criteria ?? {}),
                        ...(minimumSavingsPercent !== undefined ? { minimumSavingsPercent } : {}),
                        ...(maxStops !== undefined ? { maxStops } : {}),
                        ...(timePreference !== undefined ? { timePreference } : {}),
                        ...(timePreference === undefined && datePreference !== undefined ? { timePreference: datePreference } : {}),
                        ...(sameCabinOnly !== undefined ? { sameCabinOnly } : {}),
                    },
                    enabled,
                },
            )),
        )),
    );

    server.tool(
        "list_deal_alert_consents",
        "List enabled better-deal alert consents with current booking context for ambient flight matching.",
        {},
        withScopeCheck(async () => logToolOperation(
            requestLogger,
            "list_deal_alert_consents",
            {},
            async () => toToolContent(await api.get("/api/deal-alert-consents")),
        )),
    );

    return server;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
        return undefined;
    }

    const body = Buffer.concat(chunks).toString("utf8");

    return body ? JSON.parse(body) : undefined;
}

function sendJson(response: ServerResponse, statusCode: number, body: JsonValue) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

const httpServer = createServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = getStartTime();
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || host}`);
    const requestLogger = logger.child({
        requestId,
        method: request.method,
        path: requestUrl.pathname,
    });

    response.setHeader("X-Request-Id", requestId);
    response.on("finish", () => {
        requestLogger.info({
            statusCode: response.statusCode,
            durationMs: getDurationMs(startedAt),
        }, "HTTP request completed");
    });

    const authorizationHeader = getAuthorizationHeader(request);

    requestLogger.info({
        forwardedTokenClaims: getBearerTokenClaims(authorizationHeader),
        hasAuthorization: Boolean(authorizationHeader),
        contentLength: request.headers["content-length"],
    }, "HTTP request started");

    if (requestUrl.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });

        return;
    }

    if (requestUrl.pathname !== "/mcp") {
        sendJson(response, 404, { error: "Not found" });

        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" });

        return;
    }

    try {
        const server = createTravelMcpServer(authorizationHeader, requestLogger);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        const body = await readJsonBody(request);

        response.on("close", () => {
            requestLogger.debug("Closing MCP transport for HTTP response");
            transport.close();
        });

        await server.connect(transport);
        await transport.handleRequest(request, response, body);
    } catch (error) {
        requestLogger.error({ err: error }, "Error handling MCP request");

        if (!response.headersSent) {
            sendJson(response, 500, {
                error: error instanceof Error ? error.message : "Failed to handle MCP request.",
            });
        }
    }
});

httpServer.listen(port, host, () => {
    logger.info({
        mcpUrl: `http://${host}:${port}/mcp`,
        healthUrl: `http://${host}:${port}/health`,
    }, "Travel MCP server started");
});
