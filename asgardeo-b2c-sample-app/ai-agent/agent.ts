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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";

import { AsgardeoJavaScriptClient, type TokenResponse } from "@asgardeo/javascript";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({
    path: resolve(__dirname, ".env"),
});

const logger = createLogger();
const defaultAgentScopes = "openid profile deal-alert-consents:write";

const asgardeoConfig = {
    afterSignInUrl: process.env.REDIRECT_URI || "",
    clientId: process.env.CLIENT_ID || "",
    clientSecret: process.env.CLIENT_SECRET || "",
    baseUrl: process.env.ASGARDEO_BASE_URL || "",
    scopes: process.env.AGENT_SCOPES?.trim() || defaultAgentScopes,
};

const agentConfig = {
    agentID: process.env.AGENT_ID || "",
    agentSecret: process.env.AGENT_SECRET || "",
};

const model = new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY || "",
    model: process.env.MODEL_NAME || "gemini-2.5-flash",
});

const agentPrompt = [
    "You are Wayfinder's travel assistant.",
    "You may search flights, hotels, trip ideas, and store better-deal monitoring consent using your own agent identity.",
    "Do not create bookings, list a user's bookings, or read a user's profile from the general chat tool path. Those actions require a separate user approval flow.",
    "When a user asks to store offline better-deal alert consent for a flight booking, call store_deal_alert_consent with the exact bookingId, username, routeFrom, routeTo, criteria, and enabled values supplied by the user message.",
    "After storing consent, summarize the result briefly.",
    "Never show booking IDs, auth request IDs, access tokens, raw JSON, or other technical identifiers to the user.",
].join("\n");

type ChatMessage = {
    role: "user" | "assistant" | "system";
    content: string;
};

type ChatRequest = {
    message?: unknown;
    messages?: unknown;
};

type WebSocketFrame = {
    opcode: number;
    payload: Buffer<ArrayBufferLike>;
};

const WEB_SOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const JSON_SCHEMA_TYPE_VALUES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

type JsonSchemaObject = {
    [key: string]: unknown;
};

type ToolWithSchema = {
    name?: string;
    schema?: unknown;
    invoke?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
};

type AgentRuntime = {
    agent: ReturnType<typeof createReactAgent>;
    client: MultiServerMCPClient;
    tokenExpiresAtMs: number;
    tools: ToolWithSchema[];
};

type OboAction =
    | {
        kind: "create_booking";
        type: "flight" | "hotel";
        itemId: string;
        travelers: number;
    }
    | {
        kind: "get_flight_bookings";
    }
    | {
        kind: "get_profile";
    };

type PendingOboAuthorization = {
    action: OboAction;
    client: AsgardeoJavaScriptClient;
    createdAtMs: number;
    description: string;
    scopes: string[];
    socket: Duplex;
};

const TOKEN_REFRESH_SKEW_MS = 60_000;
const OBO_PENDING_TTL_MS = Number(process.env.OBO_PENDING_TTL_MS || 5 * 60 * 1000);

function getDefaultOboScopes(action: OboAction) {
    const scopes = new Set(["openid", "profile"]);

    if (action.kind === "create_booking") {
        scopes.add("bookings:write");
    }

    if (action.kind === "get_flight_bookings") {
        scopes.add("bookings:read");
    }

    if (action.kind === "get_profile") {
        scopes.add("profile:read");
    }

    return [...scopes];
}

function getConfiguredOboScopes(action: OboAction) {
    const configuredScopes = process.env.OBO_SCOPES?.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);

    return configuredScopes?.length ? configuredScopes : getDefaultOboScopes(action);
}

function getOboDescription(action: OboAction) {
    if (action.kind === "create_booking") {
        return `book this ${action.type}`;
    }

    if (action.kind === "get_flight_bookings") {
        return "read your flight bookings";
    }

    return "read your Wayfinder profile";
}

function getOboRedirectUri(port: number, host: string) {
    return (
        process.env.OBO_REDIRECT_URI ||
        process.env.AGENT_OBO_REDIRECT_URI ||
        process.env.REDIRECT_URI ||
        `http://${host}:${port}/oauth/callback`
    );
}

function createOboClient(redirectUri: string, scopes: string[]) {
    return new AsgardeoJavaScriptClient({
        ...asgardeoConfig,
        afterSignInUrl: redirectUri,
        scopes,
    });
}

function isToolNamed(tool: ToolWithSchema, name: string) {
    return tool.name === name || Boolean(tool.name?.endsWith(`_${name}`));
}

function decodeBase64UrlJson(value: string): Record<string, unknown> | null {
    try {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

        return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function decodeJwtPayload(accessToken: string) {
    const parts = accessToken.split(".");

    return parts.length === 3 ? decodeBase64UrlJson(parts[1]) : null;
}

function getTokenPermissionClaims(accessToken: string) {
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

function getAgentTokenExpiresAtMs(agentToken: TokenResponse) {
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

function isRuntimeNearExpiry(runtime: AgentRuntime) {
    return Date.now() + TOKEN_REFRESH_SKEW_MS >= runtime.tokenExpiresAtMs;
}

function isExpiredTokenError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    return /Token has expired|API request failed with 401/i.test(message);
}

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGeminiSchemaType(schema: JsonSchemaObject): string | undefined {
    const type = schema.type;

    if (typeof type === "string" && JSON_SCHEMA_TYPE_VALUES.has(type)) {
        return type;
    }

    if (Array.isArray(type)) {
        const nullable = type.includes("null");
        const schemaType = type.find((candidate): candidate is string => (
            typeof candidate === "string" &&
            candidate !== "null" &&
            JSON_SCHEMA_TYPE_VALUES.has(candidate)
        ));

        if (schemaType) {
            if (nullable && schema.nullable === undefined) {
                schema.nullable = true;
            }

            return schemaType;
        }
    }

    if (isJsonSchemaObject(schema.properties)) {
        return "object";
    }

    if (isJsonSchemaObject(schema.items)) {
        return "array";
    }

    if (Array.isArray(schema.enum)) {
        return "string";
    }

    return undefined;
}

function sanitizeGeminiSchema(schema: unknown): unknown {
    if (!isJsonSchemaObject(schema)) {
        return schema;
    }

    const type = getGeminiSchemaType(schema);
    const sanitized: JsonSchemaObject = {};

    if (type) {
        sanitized.type = type;
    }

    if (typeof schema.description === "string") {
        sanitized.description = schema.description;
    }

    if (typeof schema.nullable === "boolean") {
        sanitized.nullable = schema.nullable;
    }

    if (type === "string" && typeof schema.format === "string") {
        sanitized.format = schema.format;
    }

    if (type === "string" && Array.isArray(schema.enum)) {
        sanitized.enum = schema.enum.filter((value): value is string => typeof value === "string");
        sanitized.format = "enum";
    }

    if ((type === "number" || type === "integer") && typeof schema.format === "string") {
        sanitized.format = schema.format;
    }

    if (type === "array") {
        sanitized.items = sanitizeGeminiSchema(schema.items);

        if (typeof schema.minItems === "number") {
            sanitized.minItems = schema.minItems;
        }

        if (typeof schema.maxItems === "number") {
            sanitized.maxItems = schema.maxItems;
        }
    }

    if (type === "object") {
        const properties: JsonSchemaObject = {};

        if (isJsonSchemaObject(schema.properties)) {
            for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
                properties[propertyName] = sanitizeGeminiSchema(propertySchema);
            }
        }

        sanitized.properties = properties;

        if (Array.isArray(schema.required)) {
            sanitized.required = schema.required.filter((propertyName): propertyName is string => (
                typeof propertyName === "string" &&
                Object.hasOwn(properties, propertyName)
            ));
        }
    }

    return sanitized;
}

function sanitizeToolSchemasForGemini<T extends ToolWithSchema>(tools: T[]): T[] {
    return tools.map((tool) => {
        if (tool.schema) {
            tool.schema = sanitizeGeminiSchema(tool.schema);
        }

        return tool;
    });
}

function parseChatRequest(payload: string): ChatMessage[] {

    try {
        const request = JSON.parse(payload) as ChatRequest;

        if (typeof request.message === "string" && request.message.trim()) {
            return [{ role: "user", content: request.message }];
        }

        if (Array.isArray(request.messages)) {
            const messages = request.messages.filter((message): message is ChatMessage => {
                if (typeof message !== "object" || message === null) {
                    return false;
                }

                const candidate = message as Partial<ChatMessage>;

                return (
                    typeof candidate.content === "string" &&
                    ["user", "assistant", "system"].includes(candidate.role || "")
                );
            });

            if (messages.length > 0) {
                return messages;
            }
        }
    } catch {
        if (payload.trim()) {
            return [{ role: "user", content: payload }];
        }
    }

    throw new Error("Send a non-empty text message or JSON payload with a `message` field.");
}

function getResponseContent(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    return JSON.stringify(content);
}

function getToolResponseContent(result: unknown): string {
    if (typeof result === "string") {
        return result;
    }

    if (isJsonSchemaObject(result) && Array.isArray(result.content)) {
        const textParts = result.content
            .filter((item): item is { text: string } => (
                isJsonSchemaObject(item) &&
                typeof item.text === "string"
            ))
            .map((item) => item.text);

        if (textParts.length > 0) {
            return textParts.join("\n");
        }
    }

    return JSON.stringify(result);
}

function getToolText(result: unknown): string {
    return getToolResponseContent(result);
}

function parseToolJson(result: unknown): unknown {
    const text = getToolText(result);

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function parseOptionalNumber(value: string | undefined) {
    if (value === undefined || value.trim() === "") {
        return undefined;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined) {
    if (value === undefined || value.trim() === "") {
        return undefined;
    }

    return value === "true";
}

async function runHardcodedConsentCommand(message: string, tools: ToolWithSchema[]) {
    if (!message.includes("Store offline better-deal alert consent")) {
        return null;
    }

    const values = Object.fromEntries(
        message
            .split("\n")
            .map((line) => line.match(/^([A-Za-z]+):\s*(.+)$/))
            .filter((match): match is RegExpMatchArray => Boolean(match))
            .map((match) => [match[1], match[2].trim()])
    );
    const consentTool = tools.find((tool) => isToolNamed(tool, "store_deal_alert_consent"));

    if (!consentTool?.invoke) {
        const availableTools = tools
            .map((tool) => tool.name)
            .filter(Boolean)
            .join(", ");

        throw new Error(`store_deal_alert_consent tool is not available. Loaded tools: ${availableTools || "none"}.`);
    }

    const enabled = values.enabled === "true";
    let criteria: Record<string, unknown> = {};

    if (values.criteria) {
        try {
            const parsedCriteria = JSON.parse(values.criteria);

            if (isJsonSchemaObject(parsedCriteria)) {
                criteria = parsedCriteria as Record<string, unknown>;
            }
        } catch {
            criteria = {};
        }
    }

    const minimumSavingsPercent = parseOptionalNumber(values.minimumSavingsPercent);
    const maxStops = parseOptionalNumber(values.maxStops);
    const sameCabinOnly = parseOptionalBoolean(values.sameCabinOnly);

    if (minimumSavingsPercent !== undefined) {
        criteria.minimumSavingsPercent = minimumSavingsPercent;
    }

    if (values.maxStops !== undefined) {
        criteria.maxStops = maxStops ?? null;
    }

    if (values.datePreference) {
        criteria.timePreference = values.datePreference;
    }

    if (values.timePreference) {
        criteria.timePreference = values.timePreference;
    }

    if (sameCabinOnly !== undefined) {
        criteria.sameCabinOnly = sameCabinOnly;
    }

    await consentTool.invoke({
        bookingId: values.bookingId,
        username: values.username,
        routeFrom: values.routeFrom,
        routeTo: values.routeTo,
        criteria,
        enabled,
    });

    return enabled
        ? `Great, I will watch for better deals on ${values.routeFrom} to ${values.routeTo} using those criteria and ask for your consent before changing anything.`
        : "No problem. I will not send better-deal alerts for this booking.";
}

function parseTravelerCount(message: string) {
    const travelerMatch = message.match(/\b(\d+)\s*(?:traveler|travelers|passenger|passengers)\b/i);
    const travelers = travelerMatch ? Number(travelerMatch[1]) : 1;

    return Number.isInteger(travelers) && travelers >= 1 && travelers <= 9 ? travelers : 1;
}

function parseOboAction(message: string): OboAction | null {
    const normalized = message.trim().toLowerCase();

    if (!normalized) {
        return null;
    }

    if (
        /\b(my|mine)\b/.test(normalized) &&
        /\b(profile|account)\b/.test(normalized) &&
        /\b(show|view|get|read|check|load|open|what)\b/.test(normalized)
    ) {
        return { kind: "get_profile" };
    }

    if (
        /\b(my|mine)\b/.test(normalized) &&
        /\b(bookings|booking|flights|flight)\b/.test(normalized) &&
        /\b(show|view|get|read|check|list|load|open)\b/.test(normalized)
    ) {
        return { kind: "get_flight_bookings" };
    }

    if (!/\b(book|reserve|confirm)\b/.test(normalized)) {
        return null;
    }

    const itemMatch = normalized.match(/\b(flight|hotel)-[a-z0-9-]+\b/);

    if (!itemMatch) {
        return null;
    }

    return {
        kind: "create_booking",
        type: itemMatch[0].startsWith("hotel-") ? "hotel" : "flight",
        itemId: itemMatch[0],
        travelers: parseTravelerCount(message),
    };
}

function getToolOrThrow(
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

async function getDelegatedTools(accessToken: string) {
    const client = new MultiServerMCPClient({
        travel: {
            transport: "http",
            url: process.env.MCP_SERVER_URL || "http://localhost:8000/mcp",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });

    const tools = sanitizeToolSchemasForGemini(await client.getTools());

    return { client, tools };
}

function summarizeBooking(action: Extract<OboAction, { kind: "create_booking" }>, result: unknown) {
    const data = parseToolJson(result);
    const booking = isJsonSchemaObject(data) ? data : {};
    const reference = typeof booking.bookingReference === "string" ? booking.bookingReference : "";

    if (reference) {
        return `Done, I booked that ${action.type}. Your booking reference is ${reference}.`;
    }

    return `Done, I booked that ${action.type}.`;
}

function summarizeFlightBookings(result: unknown) {
    const data = parseToolJson(result);
    const bookings = isJsonSchemaObject(data) && Array.isArray(data.data) ? data.data : [];

    if (bookings.length === 0) {
        return "You do not have any flight bookings yet.";
    }

    const lines = bookings.slice(0, 3).map((booking, index) => {
        if (!isJsonSchemaObject(booking)) {
            return `${index + 1}. Flight booking`;
        }

        const flight = isJsonSchemaObject(booking.flight) ? booking.flight : {};
        const route = [flight.from, flight.to].filter((value) => typeof value === "string").join(" to ");
        const airline = typeof flight.airline === "string" ? flight.airline : "Flight";
        const dates = typeof flight.dates === "string" ? `, ${flight.dates}` : "";
        const status = typeof booking.status === "string" ? ` (${booking.status})` : "";

        return `${index + 1}. ${airline}${route ? `, ${route}` : ""}${dates}${status}`;
    });

    const suffix = bookings.length > 3 ? `\nAnd ${bookings.length - 3} more.` : "";

    return `Here are your flight bookings:\n${lines.join("\n")}${suffix}`;
}

function summarizeProfile(result: unknown) {
    const data = parseToolJson(result);
    const profile = isJsonSchemaObject(data) && isJsonSchemaObject(data.data) ? data.data : {};
    const fullName = [profile.givenName, profile.familyName]
        .filter((value) => typeof value === "string" && value.trim())
        .join(" ");
    const username = typeof profile.username === "string" ? profile.username : "";
    const email = typeof profile.email === "string" ? profile.email : "";

    return [
        "Here is the Wayfinder profile I can see with your approval:",
        fullName ? `Name: ${fullName}` : "",
        email ? `Email: ${email}` : "",
        !email && username ? `Username: ${username}` : "",
    ].filter(Boolean).join("\n");
}

async function executeOboAction(accessToken: string, action: OboAction) {
    const { client, tools } = await getDelegatedTools(accessToken);

    try {
        if (action.kind === "create_booking") {
            const tool = getToolOrThrow(tools, "create_booking");
            const result = await tool.invoke({
                type: action.type,
                itemId: action.itemId,
                travelers: action.travelers,
            });

            return summarizeBooking(action, result);
        }

        if (action.kind === "get_flight_bookings") {
            const tool = getToolOrThrow(tools, "get_flight_bookings");
            const result = await tool.invoke({});

            return summarizeFlightBookings(result);
        }

        const tool = getToolOrThrow(tools, "get_profile");
        const result = await tool.invoke({});

        return summarizeProfile(result);
    } finally {
        await client.close().catch((error: unknown) => {
            logger.warn({ err: error }, "Failed to close OBO MCP client");
        });
    }
}

function getDelegatedTokenClaims(token: TokenResponse) {
    return token.accessToken.split(".").length === 3
        ? decodeBase64UrlJson(token.accessToken.split(".")[1])
        : null;
}

function createWebSocketAcceptKey(key: string): string {
    return createHash("sha1")
        .update(`${key}${WEB_SOCKET_GUID}`)
        .digest("base64");
}

function encodeWebSocketFrame(payload: string, opcode = 0x1): Buffer {
    const payloadBuffer = Buffer.from(payload);
    const payloadLength = payloadBuffer.length;

    if (payloadLength <= 125) {
        return Buffer.concat([
            Buffer.from([0x80 | opcode, payloadLength]),
            payloadBuffer,
        ]);
    }

    if (payloadLength <= 65535) {
        const header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(payloadLength, 2);

        return Buffer.concat([header, payloadBuffer]);
    }

    const header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);

    return Buffer.concat([header, payloadBuffer]);
}

function parseWebSocketFrame(
    buffer: Buffer<ArrayBufferLike>
): { frame: WebSocketFrame; remaining: Buffer<ArrayBufferLike> } | null {
    if (buffer.length < 2) {
        return null;
    }

    const opcode = buffer[0] & 0x0f;
    const isMasked = (buffer[1] & 0x80) === 0x80;
    let payloadLength = buffer[1] & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
        if (buffer.length < offset + 2) {
            return null;
        }

        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) {
            return null;
        }

        const extendedPayloadLength = buffer.readBigUInt64BE(offset);

        if (extendedPayloadLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("WebSocket message is too large.");
        }

        payloadLength = Number(extendedPayloadLength);
        offset += 8;
    }

    const maskOffset = offset;

    if (isMasked) {
        offset += 4;
    }

    if (buffer.length < offset + payloadLength) {
        return null;
    }

    const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));

    if (isMasked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4);

        for (let index = 0; index < payload.length; index += 1) {
            payload[index] = payload[index] ^ mask[index % 4];
        }
    }

    return {
        frame: { opcode, payload },
        remaining: buffer.subarray(offset + payloadLength),
    };
}

function isSocketWritable(socket: Duplex) {
    return !socket.destroyed && !socket.writableEnded;
}

function isExpectedSocketClose(error: unknown) {
    if (!isJsonSchemaObject(error)) {
        return false;
    }

    return ["ECONNRESET", "EPIPE", "ECONNABORTED"].includes(String(error.code || ""));
}

function writeFrame(socket: Duplex, frame: Buffer) {
    if (!isSocketWritable(socket)) {
        return false;
    }

    try {
        socket.write(frame);

        return true;
    } catch (error) {
        logger.warn({ err: error }, "Unable to write WebSocket frame");

        return false;
    }
}

function sendJson(socket: Duplex, payload: Record<string, unknown>) {
    return writeFrame(socket, encodeWebSocketFrame(JSON.stringify(payload)));
}

function closeWebSocket(socket: Duplex) {
    if (isSocketWritable(socket)) {
        try {
            socket.end(encodeWebSocketFrame("", 0x8));
        } catch {
            socket.destroy();
        }
    }
}

function redactSecret(value: string) {
    if (!value) {
        return "";
    }

    if (value.length <= 6) {
        return "***";
    }

    return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function includeClientSecretInAgentAuthorizeRequest(client: AsgardeoJavaScriptClient) {
    if (!asgardeoConfig.clientSecret) {
        return;
    }

    const sdkClient = client as unknown as {
        auth?: {
            getSignInUrl?: (requestConfig?: Record<string, unknown>, userId?: string) => Promise<string>;
        };
    };
    const getSignInUrl = sdkClient.auth?.getSignInUrl?.bind(sdkClient.auth);

    if (!getSignInUrl || !sdkClient.auth) {
        return;
    }

    sdkClient.auth.getSignInUrl = async (requestConfig = {}, userId?: string) => {
        const signInUrl = await getSignInUrl({
            ...requestConfig,
            client_secret: requestConfig.client_secret ?? "__include_client_secret__",
        }, userId);

        return signInUrl;
    };
}

async function readHttpJsonBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
        return {};
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeHttpJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>) {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

async function processDealAlertWebhook(tools: ToolWithSchema[], payload: unknown) {
    if (!isJsonSchemaObject(payload) || !Array.isArray(payload.matches) || payload.matches.length === 0) {
        logger.info("Deal alert webhook did not include matching consents.");

        return;
    }

    const dealTool = tools.find((tool) => isToolNamed(tool, "process_new_flight_deal_alerts"));

    if (!dealTool?.invoke) {
        const availableTools = tools
            .map((tool) => tool.name)
            .filter(Boolean)
            .join(", ");

        throw new Error(`process_new_flight_deal_alerts tool is not available. Loaded tools: ${availableTools || "none"}.`);
    }

    logger.info({ matchCount: payload.matches.length }, "Processing matching better-deal alert consents");
    await dealTool.invoke({ matches: payload.matches as unknown[] });
}

async function createAgent() {
    logger.info("Starting Wayfinder AI agent with Asgardeo and LangChain");

    const asgardeoJavaScriptClient = new AsgardeoJavaScriptClient(asgardeoConfig);
    includeClientSecretInAgentAuthorizeRequest(asgardeoJavaScriptClient);
    const agentToken = await asgardeoJavaScriptClient.getAgentToken(agentConfig);
    const tokenExpiresAtMs = getAgentTokenExpiresAtMs(agentToken);

    logger.info({
        configuredScopes: asgardeoConfig.scopes,
        tokenClaims: getTokenPermissionClaims(agentToken.accessToken),
    }, "Received agent access token");

    const client = new MultiServerMCPClient({
        travel: {
            transport: "http",
            url: process.env.MCP_SERVER_URL || "http://localhost:8000/mcp",
            headers: {
                Authorization: `Bearer ${agentToken.accessToken}`,
            },
        },
    });

    const tools = sanitizeToolSchemasForGemini(await client.getTools());
    logger.info({
        tools: tools.map((tool) => tool.name).filter(Boolean),
    }, "Loaded MCP tools");

    const agent = createReactAgent({
        llm: model,
        tools: tools,
        prompt: agentPrompt,
    });

    logger.info({
        expiresAt: new Date(tokenExpiresAtMs).toISOString(),
    }, "Loaded MCP tools with fresh agent token");

    return { agent, client, tokenExpiresAtMs, tools };
}

async function runAgentServer() {
    let runtime = await createAgent();
    let refreshPromise: Promise<AgentRuntime> | null = null;
    const port = Number(process.env.PORT || process.env.AGENT_PORT || 8790);
    const host = process.env.HOST || "localhost";
    const oboRedirectUri = getOboRedirectUri(port, host);
    const oboCallbackPath = new URL(oboRedirectUri).pathname || "/";
    const pendingOboAuthorizations = new Map<string, PendingOboAuthorization>();

    async function refreshRuntime() {
        if (!refreshPromise) {
            const previousRuntime = runtime;

            refreshPromise = createAgent()
                .then(async (nextRuntime) => {
                    runtime = nextRuntime;

                    await previousRuntime.client.close().catch((error: unknown) => {
                        logger.warn({ err: error }, "Failed to close expired MCP client");
                    });

                    return nextRuntime;
                })
                .finally(() => {
                    refreshPromise = null;
                });
        }

        return refreshPromise;
    }

    async function getRuntime() {
        if (isRuntimeNearExpiry(runtime)) {
            logger.info("Refreshing agent token before MCP tool call");

            return refreshRuntime();
        }

        return runtime;
    }

    async function runWithFreshRuntime<T>(operation: (activeRuntime: AgentRuntime) => Promise<T>) {
        let activeRuntime = await getRuntime();

        try {
            return await operation(activeRuntime);
        } catch (error) {
            if (!isExpiredTokenError(error)) {
                throw error;
            }

            logger.warn({ err: error }, "MCP call used an expired token; refreshing and retrying once");
            activeRuntime = await refreshRuntime();

            return operation(activeRuntime);
        }
    }

    function cleanExpiredOboAuthorizations() {
        const now = Date.now();

        for (const [state, authorization] of pendingOboAuthorizations.entries()) {
            if (now - authorization.createdAtMs > OBO_PENDING_TTL_MS) {
                pendingOboAuthorizations.delete(state);
            }
        }
    }

    async function createOboAuthorization(action: OboAction, socket: Duplex) {
        cleanExpiredOboAuthorizations();

        const scopes = getConfiguredOboScopes(action);
        const client = createOboClient(oboRedirectUri, scopes);
        const authorizeUrl = await client.getOBOSignInURL(agentConfig);
        const state = new URL(authorizeUrl).searchParams.get("state");

        if (!state) {
            throw new Error("Asgardeo OBO authorize URL did not include a state value.");
        }

        const description = getOboDescription(action);

        pendingOboAuthorizations.set(state, {
            action,
            client,
            createdAtMs: Date.now(),
            description,
            scopes,
            socket,
        });

        return {
            authorizeUrl,
            description,
            scopes,
        };
    }

    async function handleOboCallback(requestUrl: URL, response: ServerResponse) {
        cleanExpiredOboAuthorizations();

        const state = requestUrl.searchParams.get("state") || "";
        const code = requestUrl.searchParams.get("code") || "";
        const sessionState = requestUrl.searchParams.get("session_state") || "";
        const error = requestUrl.searchParams.get("error");
        const errorDescription = requestUrl.searchParams.get("error_description");
        const pendingAuthorization = state ? pendingOboAuthorizations.get(state) : null;

        if (error) {
            writeHttpJson(response, 400, {
                error,
                error_description: errorDescription || "The OBO authorization request was not approved.",
            });

            if (pendingAuthorization) {
                sendJson(pendingAuthorization.socket, {
                    type: "error",
                    message: "I could not complete that action because the authorization request was not approved.",
                });
                pendingOboAuthorizations.delete(state);
            }

            return;
        }

        if (!pendingAuthorization || !code) {
            writeHttpJson(response, 400, {
                error: "Invalid or expired OBO authorization callback.",
            });

            return;
        }

        pendingOboAuthorizations.delete(state);

        try {
            includeClientSecretInAgentAuthorizeRequest(pendingAuthorization.client);
            const token = await pendingAuthorization.client.getOBOToken(agentConfig, {
                code,
                session_state: sessionState,
                state,
            });
            const claims = getDelegatedTokenClaims(token);
            const actorSubject = isJsonSchemaObject(claims?.act) ? claims.act.sub : undefined;

            logger.info({
                action: pendingAuthorization.action.kind,
                subject: claims?.sub,
                actorSubject,
                expectedActorSubject: agentConfig.agentID,
                scopes: pendingAuthorization.scopes,
            }, "Received delegated OBO access token");

            const message = await executeOboAction(token.accessToken, pendingAuthorization.action);

            sendJson(pendingAuthorization.socket, {
                type: "response",
                message,
            });
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end([
                "<!doctype html>",
                "<html><head><title>Wayfinder authorization complete</title></head>",
                "<body>",
                "<h1>Authorization complete</h1>",
                "<p>You can return to Wayfinder. The assistant has completed the approved action.</p>",
                "</body></html>",
            ].join(""));
        } catch (callbackError) {
            logger.error({ err: callbackError }, "Failed to complete OBO callback");
            sendJson(pendingAuthorization.socket, {
                type: "error",
                message: callbackError instanceof Error ? callbackError.message : "Failed to complete the approved action.",
            });
            writeHttpJson(response, 500, {
                error: callbackError instanceof Error ? callbackError.message : "Failed to complete OBO callback.",
            });
        }
    }

    const server = createServer(async (request, response) => {
        const requestId = randomUUID();
        const startedAt = performance.now();
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
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
            }, "HTTP request completed");
        });
        requestLogger.info("HTTP request started");

        if (requestUrl.pathname === "/health") {
            const activeRuntime = await getRuntime();

            writeHttpJson(response, 200, {
                status: "ok",
                features: {
                    dealAlertWebhook: true,
                    cibaBatchTool: activeRuntime.tools.some((tool) => isToolNamed(tool, "process_new_flight_deal_alerts")),
                    redirectObo: true,
                },
            });

            return;
        }

        if (request.method === "GET" && requestUrl.pathname === oboCallbackPath && requestUrl.searchParams.has("state")) {
            await handleOboCallback(requestUrl, response);

            return;
        }

        if (request.method === "POST" && requestUrl.pathname === "/deal-alerts") {
            try {
                const payload = await readHttpJsonBody(request);

                writeHttpJson(response, 202, { status: "accepted" });
                void runWithFreshRuntime((activeRuntime) => processDealAlertWebhook(activeRuntime.tools, payload)).catch((error: unknown) => {
                    requestLogger.error({ err: error }, "Error processing deal alert webhook");
                });
            } catch (error) {
                requestLogger.warn({ err: error }, "Invalid deal alert webhook payload");
                writeHttpJson(response, 400, {
                    error: error instanceof Error ? error.message : "Invalid deal alert payload.",
                });
            }

            return;
        }

        writeHttpJson(response, 404, { error: "Not found" });
    });

    const handleConnection = (socket: Duplex) => {
        const connectionId = randomUUID();
        const connectionLogger = logger.child({ connectionId });
        let isClosed = false;

        connectionLogger.info("WebSocket client connected");

        socket.on("close", () => {
            isClosed = true;
            connectionLogger.info("WebSocket client closed connection");
        });

        socket.on("end", () => {
            isClosed = true;
        });

        socket.on("error", (error) => {
            isClosed = true;

            if (isExpectedSocketClose(error)) {
                connectionLogger.debug({ err: error }, "WebSocket client disconnected");

                return;
            }

            connectionLogger.warn({ err: error }, "WebSocket client socket error");
        });

        sendJson(socket, {
            type: "ready",
            message: "Connected to the Asgardeo AI agent.",
        });

        let queue = Promise.resolve();
        let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

        socket.on("data", (data) => {
            buffer = Buffer.concat([buffer, data]);

            try {
                let parsed = parseWebSocketFrame(buffer);

                while (parsed) {
                    buffer = parsed.remaining;

                    if (parsed.frame.opcode === 0x8) {
                        closeWebSocket(socket);

                        return;
                    }

                    if (parsed.frame.opcode === 0x9) {
                        writeFrame(socket, encodeWebSocketFrame(parsed.frame.payload.toString(), 0xA));
                    }

                    if (parsed.frame.opcode === 0x1) {
                        const payload = parsed.frame.payload.toString("utf8");

                        queue = queue.then(async () => {
                            if (isClosed) {
                                return;
                            }

                            const messages = parseChatRequest(payload);
                            const latestMessage = messages[messages.length - 1]?.content || "";
                            const messageLogger = connectionLogger.child({
                                messageCount: messages.length,
                                latestMessageLength: latestMessage.length,
                            });

                            if (!sendJson(socket, { type: "processing" })) {
                                isClosed = true;
                                return;
                            }

                            messageLogger.info("Processing chat message");
                            const hardcodedResponse =
                                await runWithFreshRuntime((activeRuntime) => runHardcodedConsentCommand(latestMessage, activeRuntime.tools));

                            if (hardcodedResponse) {
                                if (isClosed) {
                                    return;
                                }

                                sendJson(socket, {
                                    type: "response",
                                    message: hardcodedResponse,
                                });
                                messageLogger.info({ responseLength: hardcodedResponse.length }, "Chat message processed");

                                return;
                            }

                            const oboAction = parseOboAction(latestMessage);

                            if (oboAction) {
                                const authorization = await createOboAuthorization(oboAction, socket);
                                const responseMessage = `I need your approval to ${authorization.description}. Open the Asgardeo consent page to continue.`;

                                if (isClosed) {
                                    return;
                                }

                                sendJson(socket, {
                                    type: "authorization_required",
                                    message: responseMessage,
                                    authorizeUrl: authorization.authorizeUrl,
                                    scopes: authorization.scopes,
                                });
                                messageLogger.info({
                                    action: oboAction.kind,
                                    scopes: authorization.scopes,
                                }, "Sent OBO authorization URL");

                                return;
                            }

                            const responseMessage = getResponseContent(
                                (await runWithFreshRuntime((activeRuntime) => activeRuntime.agent.invoke({ messages }))).messages.at(-1)?.content
                            );

                            if (isClosed) {
                                return;
                            }

                            sendJson(socket, {
                                type: "response",
                                message: responseMessage,
                            });
                            messageLogger.info({ responseLength: responseMessage.length }, "Chat message processed");
                        }).catch((error: unknown) => {
                            if (isClosed) {
                                return;
                            }

                            connectionLogger.error({ err: error }, "Error handling chat message");
                            sendJson(socket, {
                                type: "error",
                                message: error instanceof Error ? error.message : "Failed to process chat message.",
                            });
                        });
                    }

                    parsed = parseWebSocketFrame(buffer);
                }
            } catch (error) {
                connectionLogger.error({ err: error }, "Error parsing WebSocket frame");
                sendJson(socket, {
                    type: "error",
                    message: error instanceof Error ? error.message : "Invalid WebSocket message.",
                });
                closeWebSocket(socket);
            }
        });
    };

    server.on("upgrade", (request, socket, head) => {
        socket.on("error", (error) => {
            if (isExpectedSocketClose(error)) {
                logger.debug({ err: error }, "WebSocket upgrade socket closed by client");

                return;
            }

            logger.warn({ err: error }, "WebSocket upgrade socket error");
        });

        try {
            const url = new URL(request.url || "", `http://${request.headers.host || host}`);
            const key = request.headers["sec-websocket-key"];

            if (url.pathname !== "/chat" || typeof key !== "string") {
                if (!socket.destroyed && !socket.writableEnded) {
                    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
                }
                socket.destroy();

                return;
            }

            writeFrame(socket, Buffer.from([
                "HTTP/1.1 101 Switching Protocols",
                "Upgrade: websocket",
                "Connection: Upgrade",
                `Sec-WebSocket-Accept: ${createWebSocketAcceptKey(key)}`,
                "",
                "",
            ].join("\r\n")));

            if (head.length > 0) {
                socket.unshift(head);
            }

            handleConnection(socket);
        } catch (error) {
            logger.error({ err: error }, "Error upgrading WebSocket connection");
            socket.destroy();
        }
    });

    server.listen(port, host, () => {
        logger.info({
            chatUrl: `ws://${host}:${port}/chat`,
            healthUrl: `http://${host}:${port}/health`,
        }, "AI agent WebSocket server started");
    });

    const shutdown = async () => {
        logger.info("Shutting down AI agent");
        server.close();
        if (refreshPromise) {
            await refreshPromise.catch(() => null);
        }
        await runtime.client.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

runAgentServer().catch((error: unknown) => {
    logger.fatal({ err: error }, "AI agent failed to start");
    process.exit(1);
});
