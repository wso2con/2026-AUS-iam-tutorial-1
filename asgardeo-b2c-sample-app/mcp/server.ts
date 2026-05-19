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
const cibaGrantType = "urn:openid:params:grant-type:ciba";

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

function getUsernameClaimFromAccessToken(accessToken: string) {
    const parts = accessToken.split(".");

    if (parts.length !== 3) {
        throw new Error("CIBA access token is not a JWT and cannot provide a username claim.");
    }

    const payload = decodeBase64UrlJson(parts[1]);
    const username = typeof payload.username === "string" ? payload.username.trim() : "";

    if (!username) {
        throw new Error("CIBA access token did not include a username claim.");
    }

    return username;
}

function getAuthorizationHeader(request: IncomingMessage): string | undefined {
    const authorization = request.headers.authorization;

    return Array.isArray(authorization) ? authorization[0] : authorization;
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

function getRequiredEnv(name: string) {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`${name} is required for the CIBA better-deal tool. Add ASGARDEO_BASE_URL, CIBA_CLIENT_ID, and CIBA_CLIENT_SECRET to the MCP .env file, then let the dev server reload.`);
    }

    return value;
}

function getBearerToken(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) {
        return "";
    }

    return authorization.slice("Bearer ".length).trim();
}

function buildCibaAuthorizationHeader() {
    const clientId = getRequiredEnv("CIBA_CLIENT_ID");
    const clientSecret = getRequiredEnv("CIBA_CLIENT_SECRET");
    const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    return `Basic ${encodedCredentials}`;
}

async function postAsgardeoForm(
    path: string,
    body: URLSearchParams,
    signal?: AbortSignal,
    requestLogger: Logger = logger,
) {
    const startedAt = getStartTime();
    const baseUrl = getRequiredEnv("ASGARDEO_BASE_URL").replace(/\/$/, "");
    const asgardeoLogger = requestLogger.child({
        upstream: "asgardeo",
        upstreamMethod: "POST",
        upstreamPath: path,
    });

    asgardeoLogger.info({
        grantType: body.get("grant_type") || undefined,
        hasActorToken: body.has("actor_token"),
    }, "Asgardeo request started");

    const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
            Authorization: buildCibaAuthorizationHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: body.toString(),
        signal,
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok) {
        const errorCode = typeof data.error === "string" ? data.error : "";
        const errorDescription = typeof data.error_description === "string" ? data.error_description : "";
        const message = [errorCode, errorDescription]
            .filter(Boolean)
            .join(": ") || `Asgardeo request failed with ${response.status}`;

        asgardeoLogger.warn({
            statusCode: response.status,
            durationMs: getDurationMs(startedAt),
            errorCode,
        }, "Asgardeo request failed");

        throw new Error(message);
    }

    asgardeoLogger.info({
        statusCode: response.status,
        durationMs: getDurationMs(startedAt),
    }, "Asgardeo request completed");

    return data;
}

function delay(milliseconds: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("CIBA polling was canceled."));

            return;
        }

        const timeout = setTimeout(resolve, milliseconds);

        signal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("CIBA polling was canceled."));
        }, { once: true });
    });
}

async function invokeCiba({
    authorization,
    bindingMessage,
    loginHint,
    requestLogger = logger,
    signal,
}: {
    authorization?: string;
    bindingMessage: string;
    loginHint: string;
    requestLogger?: Logger;
    signal?: AbortSignal;
}) {
    const cibaStartedAt = getStartTime();
    const cibaLogger = requestLogger.child({
        flow: "ciba",
        loginHint,
    });
    const scope = process.env.CIBA_SCOPE?.trim() || "openid profile";
    const notificationChannel = process.env.CIBA_NOTIFICATION_CHANNEL?.trim() || "email";
    const cibaBody = new URLSearchParams({
        scope,
        login_hint: loginHint,
        binding_message: bindingMessage,
    });
    const actorToken = getBearerToken(authorization);

    if (notificationChannel) {
        cibaBody.set("notification_channel", notificationChannel);
    }

    if (actorToken && process.env.CIBA_INCLUDE_ACTOR_TOKEN === "true") {
        cibaBody.set("actor_token", actorToken);
    }

    cibaLogger.info({
        notificationChannel,
        scope,
        hasActorToken: cibaBody.has("actor_token"),
    }, "CIBA authorization started");

    const cibaResponse = await postAsgardeoForm("/oauth2/ciba", cibaBody, signal, cibaLogger);
    const authReqId = typeof cibaResponse.auth_req_id === "string" ? cibaResponse.auth_req_id : "";
    const authUrl = typeof cibaResponse.auth_url === "string" ? cibaResponse.auth_url : "";

    if (!authReqId) {
        throw new Error("Asgardeo CIBA response did not include auth_req_id.");
    }

    const intervalSeconds = Number(cibaResponse.interval || process.env.CIBA_POLL_INTERVAL_SECONDS || 3);
    const expiresInSeconds = Number(cibaResponse.expires_in || 120);
    const timeoutMs = Number(process.env.CIBA_POLL_TIMEOUT_MS || expiresInSeconds * 1000);

    cibaLogger.info({
        expiresInSeconds,
        hasAuthUrl: Boolean(authUrl),
        intervalSeconds,
    }, "CIBA authorization request accepted");

    if (authUrl && process.env.CIBA_LOG_AUTH_URL === "true") {
        cibaLogger.warn({
            authUrl,
        }, "CIBA authorization URL returned by Asgardeo");
    }

    const pollingStartedAt = Date.now();
    let pollCount = 0;

    while (Date.now() - pollingStartedAt < timeoutMs) {
        await delay(Math.max(intervalSeconds, 1) * 1000, signal);

        const tokenBody = new URLSearchParams({
            grant_type: cibaGrantType,
            auth_req_id: authReqId,
        });

        try {
            pollCount += 1;
            cibaLogger.debug({
                pollCount,
            }, "Polling CIBA token endpoint");
            const tokenResponse = await postAsgardeoForm("/oauth2/token", tokenBody, signal, cibaLogger);
            const accessToken = typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : "";

            if (!accessToken) {
                throw new Error("Asgardeo token response did not include access_token.");
            }

            cibaLogger.info({
                pollCount,
                durationMs: getDurationMs(cibaStartedAt),
            }, "CIBA authorization approved");

            return {
                accessToken,
                authReqId,
                authUrl: authUrl || undefined,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const normalizedMessage = message.toLowerCase().replace(/[\s-]+/g, "_");

            if (normalizedMessage.includes("authorization_pending") || normalizedMessage.includes("slow_down")) {
                continue;
            }

            throw error;
        }
    }

    cibaLogger.warn({
        pollCount,
        durationMs: getDurationMs(cibaStartedAt),
    }, "CIBA authorization timed out");

    throw new Error("Timed out waiting for the user to approve the CIBA request.");
}

const dealAlertMatchSchema = z.object({
    consent: z.object({
        bookingId: z.string(),
        username: z.string(),
        routeFrom: z.string(),
        routeTo: z.string(),
        criteria: z.record(z.string(), z.unknown()).optional(),
    }),
    currentPrice: z.number(),
    currency: z.string().optional(),
    travelers: z.number().int().optional(),
    userId: z.string().optional(),
    newFlight: z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        airline: z.string().optional(),
        departureTime: z.string().optional(),
        arrivalTime: z.string().optional(),
        stops: z.number().int().optional(),
        price: z.number(),
        currency: z.string().optional(),
        cabin: z.string().optional(),
        dates: z.string().optional(),
    }),
});

type DealAlertMatch = z.infer<typeof dealAlertMatchSchema>;

async function reserveBetterDealForMatch({
    api,
    authorization,
    match,
    onApproved,
    requestLogger,
    signal,
}: {
    api: ReturnType<typeof createApiClient>;
    authorization?: string;
    match: DealAlertMatch;
    onApproved?: () => boolean;
    requestLogger: Logger;
    signal: AbortSignal;
}) {
    const { consent, newFlight } = match;
    const currentPrice = Number(match.currentPrice);
    const newPrice = Number(newFlight.price);
    const savingsPercent = Number((((currentPrice - newPrice) / currentPrice) * 100).toFixed(1));
    const dealLogger = requestLogger.child({
        flow: "better-deal",
        routeFrom: consent.routeFrom,
        routeTo: consent.routeTo,
        bookingId: consent.bookingId,
        newFlightId: newFlight.id,
    });

    dealLogger.info({
        currentPrice,
        newPrice,
        savingsPercent,
    }, "Starting better-deal approval flow");

    const ciba = await invokeCiba({
        authorization,
        loginHint: consent.username,
        bindingMessage: `Approve booking the new ${newFlight.from} to ${newFlight.to} flight on ${newFlight.airline || "a partner airline"} departing at ${newFlight.departureTime} on ${newFlight.dates} at ${newFlight.currency || match.currency || "USD"} ${newPrice}. Your existing booking will be canceled.`,
        requestLogger: dealLogger,
        signal,
    });

    if (onApproved && !onApproved()) {
        throw new Error("Another user approved this better deal first.");
    }

    const approvedUsername = getUsernameClaimFromAccessToken(ciba.accessToken);
    dealLogger.info({
        approvedUsername,
    }, "Better-deal booking approved");
    const user = {
        id: approvedUsername,
        username: approvedUsername,
    };
    const userHeaders = {
        "X-Wayfinder-User-Id": approvedUsername,
        "X-Wayfinder-Username": approvedUsername,
        "X-Wayfinder-Email": approvedUsername,
    };
    const booking = await api.postWithBearer("/api/bookings", {
        type: "flight",
        itemId: newFlight.id,
        travelers: match.travelers ?? 1,
        user,
    }, ciba.accessToken, userHeaders);
    const createdBooking = (
        typeof booking === "object" &&
        booking !== null &&
        !Array.isArray(booking) &&
        typeof booking.id === "string"
    ) ? booking : null;

    if (!createdBooking) {
        throw new Error("Replacement booking response did not include a booking id.");
    }

    dealLogger.info({
        replacementBookingId: createdBooking.id,
    }, "Replacement booking created");

    const transferredConsent = await api.postWithBearer("/api/deal-alert-consents/transfer", {
        fromBookingId: consent.bookingId,
        toBookingId: createdBooking.id,
        username: approvedUsername,
    }, ciba.accessToken, userHeaders);
    const canceledBooking = await api.patch(
        `/api/bookings/${encodeURIComponent(consent.bookingId)}/cancel`,
        {
            username: approvedUsername,
            preserveDealAlerts: true,
        },
        ciba.accessToken,
        userHeaders,
    );

    dealLogger.info({
        canceledBookingId: consent.bookingId,
        replacementBookingId: createdBooking.id,
    }, "Better-deal booking swap completed");

    return {
        username: approvedUsername,
        routeFrom: consent.routeFrom,
        routeTo: consent.routeTo,
        previousPrice: currentPrice,
        newPrice,
        savingsPercent,
        booking,
        transferredConsent,
        canceledBooking,
    };
}

async function reserveFirstApprovedBetterDeal({
    api,
    authorization,
    matches,
    requestLogger,
}: {
    api: ReturnType<typeof createApiClient>;
    authorization?: string;
    matches: DealAlertMatch[];
    requestLogger: Logger;
}) {
    if (matches.length === 0) {
        throw new Error("At least one matching deal alert consent is required.");
    }

    const controllers = matches.map(() => new AbortController());
    const errors: string[] = [];
    const flowLogger = requestLogger.child({
        flow: "better-deal-batch",
        matchCount: matches.length,
    });

    flowLogger.info("Starting better-deal approval batch");

    return await new Promise<JsonValue>((resolve, reject) => {
        let approvedIndex: number | null = null;
        let settled = false;
        let remaining = matches.length;

        matches.forEach((match, index) => {
            reserveBetterDealForMatch({
                api,
                authorization,
                match,
                requestLogger: flowLogger,
                onApproved: () => {
                    if (approvedIndex !== null) {
                        return false;
                    }

                    approvedIndex = index;
                    flowLogger.info({
                        approvedIndex,
                    }, "Better-deal approval won batch");
                    controllers.forEach((controller, controllerIndex) => {
                        if (controllerIndex !== index) {
                            controller.abort();
                        }
                    });

                    return true;
                },
                signal: controllers[index].signal,
            }).then((result) => {
                if (settled) {
                    return;
                }

                settled = true;
                flowLogger.info({
                    approvedIndex: index,
                }, "Better-deal batch completed");
                resolve(result as JsonValue);
            }).catch((error: unknown) => {
                if (settled) {
                    return;
                }

                if (approvedIndex === index) {
                    settled = true;
                    flowLogger.error({
                        approvedIndex: index,
                        err: error,
                    }, "Approved better-deal flow failed");
                    reject(error);

                    return;
                }

                if (approvedIndex !== null) {
                    return;
                }

                remaining -= 1;
                errors.push(error instanceof Error ? error.message : String(error));
                flowLogger.warn({
                    failedIndex: index,
                    remaining,
                    err: error,
                }, "Better-deal approval flow failed or was declined");

                if (remaining === 0) {
                    reject(new Error(`No user approved the better-deal booking. ${errors.join(" ")}`.trim()));
                }
            });
        });
    });
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
        async ({ from, to }) => logToolOperation(requestLogger, "search_flights", { from, to }, async () => {
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
    );

    server.tool(
        "search_hotels",
        "Search available hotels from the travel API.",
        {
            location: z.string().optional().describe("Hotel location, for example Singapore."),
        },
        async ({ location }) => logToolOperation(requestLogger, "search_hotels", { location }, async () => {
            const params = new URLSearchParams();

            if (location) {
                params.set("location", location);
            }

            const query = params.toString();

            return toToolContent(await api.get(`/api/hotels${query ? `?${query}` : ""}`));
        }),
    );

    server.tool(
        "get_trips",
        "Get saved trip ideas from the travel API.",
        {},
        async () => logToolOperation(requestLogger, "get_trips", {}, async () => (
            toToolContent(await api.get("/api/trips"))
        )),
    );

    server.tool(
        "get_locations",
        "Get available travel locations from the travel API.",
        {
            category: z.enum(["flights", "hotels"]).optional().describe("Optional location category."),
        },
        async ({ category }) => logToolOperation(requestLogger, "get_locations", { category }, async () => {
            const query = category ? `?${new URLSearchParams({ category }).toString()}` : "";

            return toToolContent(await api.get(`/api/locations${query}`));
        }),
    );

    server.tool(
        "create_booking",
        "Create a sample booking in the travel API.",
        {
            type: z.enum(["flight", "hotel"]).describe("Booking type."),
            itemId: z.string().describe("Flight or hotel item ID to book."),
            travelers: z.number().int().optional().describe("Number of travelers."),
        },
        async ({ type, itemId, travelers }) => logToolOperation(
            requestLogger,
            "create_booking",
            { type, itemId, travelers },
            async () => toToolContent(await api.post("/api/bookings", {
                type,
                itemId,
                travelers: travelers ?? 1,
            })),
        ),
    );

    server.tool(
        "get_flight_bookings",
        "Get flight bookings for the current authenticated user.",
        {},
        async () => logToolOperation(requestLogger, "get_flight_bookings", {}, async () => (
            toToolContent(await api.get("/api/bookings/flights"))
        )),
    );

    server.tool(
        "get_profile",
        "Get the current authenticated user's profile from the travel API.",
        {},
        async () => logToolOperation(requestLogger, "get_profile", {}, async () => (
            toToolContent(await api.get("/api/me"))
        )),
    );

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
        async ({
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
        ),
    );

    server.tool(
        "process_new_flight_deal_alerts",
        "For a newly added flight, initiate CIBA requests for matching deal-alert consents, book the new flight for the first approving user, cancel their previous flight, and cancel the remaining pending polls.",
        {
            matches: z.array(dealAlertMatchSchema).min(1).describe("Deal-alert consent matches produced by the flight insertion listener."),
        },
        async ({ matches }) => logToolOperation(
            requestLogger,
            "process_new_flight_deal_alerts",
            { matches },
            async () => {
                const result = await reserveFirstApprovedBetterDeal({
                    api,
                    authorization,
                    matches,
                    requestLogger,
                });

                return toToolContent({ data: result });
            },
        ),
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
