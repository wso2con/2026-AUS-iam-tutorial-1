import type { IncomingMessage, ServerResponse } from "node:http";

import type { TokenResponse } from "@asgardeo/javascript";
import type { BindingMessageAgent } from "./llm.js";
import type {
    AgentRuntime,
    DealAlertCandidate,
    DealAlertMatch,
    Flight,
    JsonObject,
    ToolWithSchema,
} from "./models.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_BINDING_MESSAGE_LENGTH = 220;

export function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64UrlJson(value: string): JsonObject | null {
    try {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

        return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as JsonObject;
    } catch {
        return null;
    }
}

function decodeJwtPayload(accessToken: string) {
    const parts = accessToken.split(".");

    return parts.length === 3 ? decodeBase64UrlJson(parts[1]) : null;
}

export function getTokenPermissionClaims(accessToken: string) {
    const payload = decodeJwtPayload(accessToken);

    return {
        audience: payload?.aud,
        issuer: payload?.iss,
        permissions: payload?.permissions,
        roles: payload?.roles,
        scope: payload?.scope,
        scp: payload?.scp,
        subject: payload?.sub,
    };
}

export function getAgentTokenExpiresAtMs(agentToken: TokenResponse) {
    const jwtPayload = decodeJwtPayload(agentToken.accessToken);
    const jwtExpiration = jwtPayload && typeof jwtPayload.exp === "number"
        ? jwtPayload.exp * 1000
        : 0;

    if (jwtExpiration > 0) {
        return jwtExpiration;
    }

    const createdAt = Number(agentToken.createdAt);
    const expiresIn = Number(agentToken.expiresIn);

    if (Number.isFinite(expiresIn) && expiresIn > 0) {
        return (Number.isFinite(createdAt) && createdAt > 0 ? createdAt * 1000 : Date.now()) + (expiresIn * 1000);
    }

    return Date.now() + (5 * 60 * 1000);
}

export function isRuntimeNearExpiry(runtime: AgentRuntime) {
    return Date.now() + TOKEN_REFRESH_SKEW_MS >= runtime.tokenExpiresAtMs;
}

export function isExpiredTokenError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    return /Token has expired|API request failed with 401/i.test(message);
}

export function isToolNamed(tool: ToolWithSchema, name: string) {
    return tool.name === name || Boolean(tool.name?.endsWith(`_${name}`));
}

export function getToolOrThrow(
    tools: ToolWithSchema[],
    toolName: string,
): ToolWithSchema & { invoke: (input: Record<string, unknown>) => Promise<unknown> | unknown } {
    const tool = tools.find((candidate) => isToolNamed(candidate, toolName));

    if (!tool?.invoke) {
        const availableTools = tools
            .map((candidate) => candidate.name)
            .filter(Boolean)
            .join(", ");

        throw new Error(`${toolName} tool is not available. Loaded tools: ${availableTools || "none"}.`);
    }

    return tool as ToolWithSchema & {
        invoke: (input: Record<string, unknown>) => Promise<unknown> | unknown;
    };
}

function getToolResponseText(result: unknown): string {
    if (typeof result === "string") {
        return result;
    }

    if (isJsonObject(result) && Array.isArray(result.content)) {
        const textParts = result.content
            .filter((item): item is { text: string } => (
                isJsonObject(item) &&
                typeof item.text === "string"
            ))
            .map((item) => item.text);

        if (textParts.length > 0) {
            return textParts.join("\n");
        }
    }

    return JSON.stringify(result);
}

function parseToolJson(result: unknown): unknown {
    try {
        return JSON.parse(getToolResponseText(result));
    } catch {
        return null;
    }
}

export async function readHttpJsonBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
        return {};
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function writeHttpJson(response: ServerResponse, statusCode: number, body: JsonObject) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

function parseFlightStartDate(value: unknown) {
    const match = String(value || "").match(/\b([A-Za-z]{3,9})\s+(\d{1,2})\b/);

    if (!match) {
        return null;
    }

    const parsed = Date.parse(`${match[1]} ${match[2]}, 2026 00:00:00 UTC`);

    return Number.isNaN(parsed) ? null : parsed;
}

function parseTimeMinutes(value: unknown) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);

    if (!match) {
        return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
        return null;
    }

    return (hours * 60) + minutes;
}

function criteriaMatchesFlight(criteria: JsonObject = {}, candidate: DealAlertCandidate, newFlight: Flight) {
    const minimumSavingsPercent = Number(criteria.minimumSavingsPercent ?? 0);
    const maxStopsValue = criteria.maxStops;
    const maxStops = maxStopsValue === null || maxStopsValue === undefined || maxStopsValue === ""
        ? null
        : Number(maxStopsValue);
    const timePreference = String(criteria.timePreference || criteria.datePreference || "any");
    const sameCabinOnly = Boolean(criteria.sameCabinOnly);
    const currentPrice = Number(candidate.currentPrice);
    const newPrice = Number(newFlight.price);

    if (!Number.isFinite(currentPrice) || !Number.isFinite(newPrice) || newPrice >= currentPrice) {
        return false;
    }

    if (Number.isFinite(minimumSavingsPercent) && minimumSavingsPercent > 0) {
        const savingsPercent = ((currentPrice - newPrice) / currentPrice) * 100;

        if (savingsPercent < minimumSavingsPercent) {
            return false;
        }
    }

    if (maxStops !== null && Number.isFinite(maxStops) && Number(newFlight.stops) > maxStops) {
        return false;
    }

    if (
        sameCabinOnly &&
        String(newFlight.cabin || "").toLowerCase() !== String(candidate.currentCabin || "").toLowerCase()
    ) {
        return false;
    }

    if (timePreference === "earlier" || timePreference === "later") {
        const currentDate = parseFlightStartDate(candidate.currentDates);
        const newDate = parseFlightStartDate(newFlight.dates);
        const currentDepartureMinutes = parseTimeMinutes(candidate.currentDepartureTime);
        const newDepartureMinutes = parseTimeMinutes(newFlight.departureTime);

        if (
            currentDate === null ||
            newDate === null ||
            currentDate !== newDate ||
            currentDepartureMinutes === null ||
            newDepartureMinutes === null
        ) {
            return false;
        }

        if (timePreference === "earlier" && newDepartureMinutes >= currentDepartureMinutes) {
            return false;
        }

        if (timePreference === "later" && newDepartureMinutes <= currentDepartureMinutes) {
            return false;
        }
    }

    return true;
}

function normalizeFlight(value: unknown): Flight {
    if (!isJsonObject(value)) {
        throw new Error("Request body must include a flight object.");
    }

    const id = String(value.id || "").trim();
    const from = String(value.from || "").trim();
    const to = String(value.to || "").trim();
    const price = Number(value.price);

    if (!id || !from || !to || !Number.isFinite(price) || price <= 0) {
        throw new Error("Flight must include id, from, to, and a positive price.");
    }

    return {
        id,
        from,
        to,
        airline: typeof value.airline === "string" ? value.airline : undefined,
        departureTime: typeof value.departureTime === "string" ? value.departureTime : undefined,
        arrivalTime: typeof value.arrivalTime === "string" ? value.arrivalTime : undefined,
        duration: typeof value.duration === "string" ? value.duration : undefined,
        stops: Number.isFinite(Number(value.stops)) ? Number(value.stops) : undefined,
        price,
        currency: typeof value.currency === "string" ? value.currency : undefined,
        cabin: typeof value.cabin === "string" ? value.cabin : undefined,
        dates: typeof value.dates === "string" ? value.dates : undefined,
        tags: Array.isArray(value.tags) ? value.tags.map((tag) => String(tag)) : undefined,
    };
}

export function getFlightFromPayload(payload: unknown) {
    if (isJsonObject(payload) && isJsonObject(payload.flight)) {
        return normalizeFlight(payload.flight);
    }

    return normalizeFlight(payload);
}

function normalizeConsentCandidate(value: unknown): DealAlertCandidate | null {
    if (!isJsonObject(value)) {
        return null;
    }

    const consentValue = isJsonObject(value.consent) ? value.consent : value;
    const bookingId = String(consentValue.bookingId || "").trim();
    const username = String(consentValue.username || "").trim();
    const routeFrom = String(consentValue.routeFrom || "").trim();
    const routeTo = String(consentValue.routeTo || "").trim();
    const currentPrice = Number(value.currentPrice);

    if (!bookingId || !username || !routeFrom || !routeTo || !Number.isFinite(currentPrice)) {
        return null;
    }

    return {
        consent: {
            id: typeof consentValue.id === "string" ? consentValue.id : undefined,
            bookingId,
            username,
            routeFrom,
            routeTo,
            criteria: isJsonObject(consentValue.criteria) ? consentValue.criteria : {},
            enabled: consentValue.enabled === undefined ? true : Boolean(consentValue.enabled),
            createdAt: typeof consentValue.createdAt === "string" ? consentValue.createdAt : null,
            updatedAt: typeof consentValue.updatedAt === "string" ? consentValue.updatedAt : null,
        },
        currentPrice,
        currentCabin: typeof value.currentCabin === "string" ? value.currentCabin : null,
        currentDates: typeof value.currentDates === "string" ? value.currentDates : null,
        currentDepartureTime: typeof value.currentDepartureTime === "string" ? value.currentDepartureTime : null,
        currency: typeof value.currency === "string" ? value.currency : null,
        travelers: Number.isInteger(Number(value.travelers)) ? Number(value.travelers) : null,
        userId: typeof value.userId === "string" ? value.userId : null,
    };
}

export async function listDealAlertCandidates(tools: ToolWithSchema[]) {
    const listTool = getToolOrThrow(tools, "list_deal_alert_consents");
    const result = await listTool.invoke({});
    const data = parseToolJson(result);
    const rawCandidates = isJsonObject(data) && Array.isArray(data.data) ? data.data : [];

    return rawCandidates
        .map(normalizeConsentCandidate)
        .filter((candidate): candidate is DealAlertCandidate => Boolean(candidate));
}

export function findMatchingDealAlerts(flight: Flight, candidates: DealAlertCandidate[]): DealAlertMatch[] {
    return candidates
        .filter((candidate) => (
            candidate.consent.enabled !== false &&
            candidate.consent.routeFrom.toLowerCase() === flight.from.toLowerCase() &&
            candidate.consent.routeTo.toLowerCase() === flight.to.toLowerCase() &&
            criteriaMatchesFlight(candidate.consent.criteria, candidate, flight)
        ))
        .map((candidate) => ({
            ...candidate,
            newFlight: flight,
        }));
}

function getResponseContent(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (isJsonObject(item) && typeof item.text === "string") {
                    return item.text;
                }

                return "";
            })
            .filter(Boolean)
            .join("\n");
    }

    return JSON.stringify(content);
}

function getAgentResponseText(result: unknown) {
    if (!isJsonObject(result) || !Array.isArray(result.messages)) {
        return "";
    }

    const lastMessage = result.messages.at(-1);
    const content = isJsonObject(lastMessage) ? lastMessage.content : undefined;

    return getResponseContent(content);
}

function parseJsonFromText(text: string): JsonObject | null {
    try {
        const parsed = JSON.parse(text);

        return isJsonObject(parsed) ? parsed : null;
    } catch {
        const match = text.match(/\{[\s\S]*\}/);

        if (!match) {
            return null;
        }

        try {
            const parsed = JSON.parse(match[0]);

            return isJsonObject(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
}

function truncateBindingMessage(value: string) {
    if (value.length <= MAX_BINDING_MESSAGE_LENGTH) {
        return value;
    }

    return value.slice(0, MAX_BINDING_MESSAGE_LENGTH - 1).trimEnd();
}

function sanitizeBindingMessage(value: unknown) {
    if (typeof value !== "string") {
        return "";
    }

    return truncateBindingMessage(value.replace(/\s+/g, " ").trim());
}

function createFallbackBindingMessage(match: DealAlertMatch) {
    const { newFlight } = match;
    const currency = newFlight.currency || match.currency || "USD";
    const currentPrice = Number(match.currentPrice);
    const newPrice = Number(newFlight.price);
    const savingsText = Number.isFinite(currentPrice) && Number.isFinite(newPrice)
        ? `, saving ${currency} ${Number((currentPrice - newPrice).toFixed(2))}`
        : "";
    const dateText = [newFlight.departureTime, newFlight.dates].filter(Boolean).join(" on ");
    const flightText = [
        newFlight.airline || "a partner airline",
        dateText ? `departing ${dateText}` : "",
    ].filter(Boolean).join(" ");

    return truncateBindingMessage(
        `Approve switching your ${newFlight.from} to ${newFlight.to} flight to ${flightText} for ${currency} ${newPrice}${savingsText}. Your existing booking will be canceled.`
    );
}

function getBindingMessageInputs(matches: DealAlertMatch[]) {
    return matches.map((match) => {
        const currentPrice = Number(match.currentPrice);
        const newPrice = Number(match.newFlight.price);
        const currency = match.newFlight.currency || match.currency || "USD";
        const savingsAmount = Number.isFinite(currentPrice) && Number.isFinite(newPrice)
            ? Number((currentPrice - newPrice).toFixed(2))
            : null;
        const savingsPercent = Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(newPrice)
            ? Number((((currentPrice - newPrice) / currentPrice) * 100).toFixed(1))
            : null;

        return {
            bookingId: match.consent.bookingId,
            routeFrom: match.consent.routeFrom,
            routeTo: match.consent.routeTo,
            currentPrice,
            newFlight: {
                airline: match.newFlight.airline,
                departureTime: match.newFlight.departureTime,
                dates: match.newFlight.dates,
                price: newPrice,
                currency,
            },
            savingsAmount,
            savingsPercent,
            criteria: match.consent.criteria ?? {},
        };
    });
}

export async function addSmartBindingMessages(
    bindingMessageAgent: BindingMessageAgent,
    matches: DealAlertMatch[],
) {
    const fallbackMatches = matches.map((match) => ({
        ...match,
        bindingMessage: createFallbackBindingMessage(match),
    }));

    if (matches.length === 0) {
        return fallbackMatches;
    }

    const result = await bindingMessageAgent.invoke({
        messages: [
            {
                role: "user",
                content: JSON.stringify({
                    task: "Create smart CIBA binding messages for these better-flight matches.",
                    matches: getBindingMessageInputs(matches),
                }),
            },
        ],
    });
    const parsed = parseJsonFromText(getAgentResponseText(result));
    const messages = isJsonObject(parsed) && Array.isArray(parsed.messages)
        ? parsed.messages
        : [];
    const messageByBookingId = new Map<string, string>();

    for (const item of messages) {
        if (!isJsonObject(item)) {
            continue;
        }

        const bookingId = typeof item.bookingId === "string" ? item.bookingId : "";
        const bindingMessage = sanitizeBindingMessage(item.bindingMessage);

        if (bookingId && bindingMessage) {
            messageByBookingId.set(bookingId, bindingMessage);
        }
    }

    return fallbackMatches.map((match) => ({
        ...match,
        bindingMessage: messageByBookingId.get(match.consent.bookingId) || match.bindingMessage,
    }));
}
