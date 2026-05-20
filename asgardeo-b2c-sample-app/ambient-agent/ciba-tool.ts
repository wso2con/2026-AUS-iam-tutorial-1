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

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "./logger.js";

const cibaGrantType = "urn:openid:params:grant-type:ciba";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Logger = ReturnType<typeof createLogger>;

function decodeBase64UrlJson(value: string) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
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

function getRequiredEnv(name: string) {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`${name} is required for the ambient CIBA better-deal tool.`);
    }

    return value;
}

function getCibaAuthorizationHeader() {
    const clientId = getRequiredEnv("CLIENT_ID");
    const clientSecret = getRequiredEnv("CLIENT_SECRET");
    const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    return `Basic ${encodedCredentials}`;
}

function getApiBaseUrl() {
    return process.env.API_BASE_URL || "http://localhost:8787";
}

async function requestApi(
    path: string,
    options: RequestInit,
    requestLogger: Logger,
) {
    const headers = new Headers(options.headers);
    const baseUrl = getApiBaseUrl();
    const apiLogger = requestLogger.child({
        upstream: "travel-api",
        upstreamMethod: options.method || "GET",
        upstreamPath: path,
    });

    headers.set("Accept", "application/json");

    if (options.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    apiLogger.info({
        hasAuthorization: headers.has("Authorization"),
    }, "API request started");

    const response = await fetch(`${baseUrl}${path}`, {
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
        }, "API request failed");

        throw new Error(`API request failed with ${response.status}: ${JSON.stringify(body)}`);
    }

    apiLogger.info({
        statusCode: response.status,
    }, "API request completed");

    return body as JsonValue;
}

function createUserHeaders(username: string) {
    return {
        "X-Wayfinder-User-Id": username,
        "X-Wayfinder-Username": username,
        "X-Wayfinder-Email": username,
    };
}

async function postWithBearer(
    path: string,
    body: JsonValue,
    bearerToken: string,
    userHeaders: Record<string, string>,
    requestLogger: Logger,
) {
    return requestApi(path, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${bearerToken}`,
            ...userHeaders,
        },
        body: JSON.stringify(body),
    }, requestLogger);
}

async function patchWithBearer(
    path: string,
    body: JsonValue,
    bearerToken: string,
    userHeaders: Record<string, string>,
    requestLogger: Logger,
) {
    return requestApi(path, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${bearerToken}`,
            ...userHeaders,
        },
        body: JSON.stringify(body),
    }, requestLogger);
}

async function postAsgardeoForm(
    path: string,
    body: URLSearchParams,
    signal: AbortSignal | undefined,
    requestLogger: Logger,
) {
    const baseUrl = getRequiredEnv("ASGARDEO_BASE_URL").replace(/\/$/, "");
    const cibaAuthorization = getCibaAuthorizationHeader();
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
            Authorization: cibaAuthorization,
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
            errorCode,
            statusCode: response.status,
        }, "Asgardeo request failed");

        throw new Error(message);
    }

    asgardeoLogger.info({
        statusCode: response.status,
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

const dealAlertMatchSchema = z.object({
    consent: z.object({
        id: z.string().optional(),
        bookingId: z.string(),
        username: z.string(),
        routeFrom: z.string(),
        routeTo: z.string(),
        criteria: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional(),
        createdAt: z.string().nullish(),
        updatedAt: z.string().nullish(),
    }),
    currentPrice: z.number(),
    currentCabin: z.string().nullish(),
    currentDates: z.string().nullish(),
    currentDepartureTime: z.string().nullish(),
    currency: z.string().nullish(),
    travelers: z.number().int().nullish(),
    userId: z.string().nullish(),
    bindingMessage: z.string().nullish(),
    newFlight: z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        airline: z.string().nullish(),
        departureTime: z.string().nullish(),
        arrivalTime: z.string().nullish(),
        duration: z.string().nullish(),
        stops: z.number().int().nullish(),
        price: z.number(),
        currency: z.string().nullish(),
        cabin: z.string().nullish(),
        dates: z.string().nullish(),
        tags: z.array(z.string()).optional(),
    }),
});

type DealAlertMatchInput = z.infer<typeof dealAlertMatchSchema>;

function getBetterDealBindingMessage(match: DealAlertMatchInput) {
    const { newFlight } = match;
    const newPrice = Number(newFlight.price);
    const fallbackMessage = `Approve booking the new ${newFlight.from} to ${newFlight.to} flight on ${newFlight.airline || "a partner airline"} departing at ${newFlight.departureTime} on ${newFlight.dates} at ${newFlight.currency || match.currency || "USD"} ${newPrice}. Your existing booking will be canceled.`;
    const bindingMessage = typeof match.bindingMessage === "string"
        ? match.bindingMessage.replace(/\s+/g, " ").trim()
        : "";

    if (!bindingMessage) {
        return fallbackMessage;
    }

    return bindingMessage.toLowerCase().includes("canceled")
        ? bindingMessage
        : `${bindingMessage} Existing booking will be canceled.`;
}

async function invokeCiba({
    agentAccessToken,
    bindingMessage,
    loginHint,
    requestLogger,
    signal,
}: {
    agentAccessToken: string;
    bindingMessage: string;
    loginHint: string;
    requestLogger: Logger;
    signal?: AbortSignal;
}) {
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
        actor_token: agentAccessToken,
    });

    if (notificationChannel) {
        cibaBody.set("notification_channel", notificationChannel);
    }

    cibaLogger.info({
        hasActorToken: cibaBody.has("actor_token"),
        notificationChannel,
        scope,
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
    const pollingStartedAt = Date.now();
    let pollCount = 0;

    cibaLogger.info({
        expiresInSeconds,
        hasAuthUrl: Boolean(authUrl),
        intervalSeconds,
    }, "CIBA authorization request accepted");

    if (authUrl && process.env.CIBA_LOG_AUTH_URL === "true") {
        cibaLogger.warn({ authUrl }, "CIBA authorization URL returned by Asgardeo");
    }

    while (Date.now() - pollingStartedAt < timeoutMs) {
        await delay(Math.max(intervalSeconds, 1) * 1000, signal);

        const tokenBody = new URLSearchParams({
            grant_type: cibaGrantType,
            auth_req_id: authReqId,
        });

        try {
            pollCount += 1;
            cibaLogger.debug({ pollCount }, "Polling CIBA token endpoint");

            const tokenResponse = await postAsgardeoForm("/oauth2/token", tokenBody, signal, cibaLogger);
            const accessToken = typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : "";

            if (!accessToken) {
                throw new Error("Asgardeo token response did not include access_token.");
            }

            cibaLogger.info({ pollCount }, "CIBA authorization approved");

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

    cibaLogger.warn({ pollCount }, "CIBA authorization timed out");

    throw new Error("Timed out waiting for the user to approve the CIBA request.");
}

async function reserveBetterDealForMatch({
    agentAccessToken,
    match,
    onApproved,
    requestLogger,
    signal,
}: {
    agentAccessToken: string;
    match: DealAlertMatchInput;
    onApproved?: () => boolean;
    requestLogger: Logger;
    signal: AbortSignal;
}) {
    const { consent, newFlight } = match;
    const currentPrice = Number(match.currentPrice);
    const newPrice = Number(newFlight.price);
    const savingsPercent = Number((((currentPrice - newPrice) / currentPrice) * 100).toFixed(1));
    const dealLogger = requestLogger.child({
        bookingId: consent.bookingId,
        flow: "better-deal",
        newFlightId: newFlight.id,
        routeFrom: consent.routeFrom,
        routeTo: consent.routeTo,
    });

    dealLogger.info({
        currentPrice,
        newPrice,
        savingsPercent,
    }, "Starting better-deal approval flow");

    const ciba = await invokeCiba({
        agentAccessToken,
        bindingMessage: getBetterDealBindingMessage(match),
        loginHint: consent.username,
        requestLogger: dealLogger,
        signal,
    });

    if (onApproved && !onApproved()) {
        throw new Error("Another user approved this better deal first.");
    }

    const approvedUsername = getUsernameClaimFromAccessToken(ciba.accessToken);
    const userHeaders = createUserHeaders(approvedUsername);
    const user = {
        id: approvedUsername,
        username: approvedUsername,
    };

    dealLogger.info({ approvedUsername }, "Better-deal booking approved");

    const booking = await postWithBearer("/api/bookings", {
        type: "flight",
        itemId: newFlight.id,
        travelers: match.travelers ?? 1,
        user,
    }, ciba.accessToken, userHeaders, dealLogger);
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

    const transferredConsent = await postWithBearer("/api/deal-alert-consents/transfer", {
        fromBookingId: consent.bookingId,
        toBookingId: createdBooking.id,
        username: approvedUsername,
    }, ciba.accessToken, userHeaders, dealLogger);
    const canceledBooking = await patchWithBearer(
        `/api/bookings/${encodeURIComponent(consent.bookingId)}/cancel`,
        {
            username: approvedUsername,
            preserveDealAlerts: true,
        },
        ciba.accessToken,
        userHeaders,
        dealLogger,
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
    agentAccessToken,
    matches,
    requestLogger,
}: {
    agentAccessToken: string;
    matches: DealAlertMatchInput[];
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
                agentAccessToken,
                match,
                onApproved: () => {
                    if (approvedIndex !== null) {
                        return false;
                    }

                    approvedIndex = index;
                    flowLogger.info({ approvedIndex }, "Better-deal approval won batch");
                    controllers.forEach((controller, controllerIndex) => {
                        if (controllerIndex !== index) {
                            controller.abort();
                        }
                    });

                    return true;
                },
                requestLogger: flowLogger,
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

export function createProcessNewFlightDealAlertsTool(agentAccessToken: string, requestLogger: Logger = createLogger()) {
    return tool(
        async ({ matches }) => {
            const result = await reserveFirstApprovedBetterDeal({
                agentAccessToken,
                matches,
                requestLogger,
            });

            return JSON.stringify({ data: result }, null, 2);
        },
        {
            name: "process_new_flight_deal_alerts",
            description: "For a newly added flight, initiate CIBA requests for matching deal-alert consents, book the new flight for the first approving user, cancel their previous flight, and cancel the remaining pending polls.",
            schema: z.object({
                matches: z.array(dealAlertMatchSchema).min(1).describe("Deal-alert consent matches produced by the flight insertion listener."),
            }),
        },
    );
}
