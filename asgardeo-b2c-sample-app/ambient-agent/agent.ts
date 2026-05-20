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
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AsgardeoJavaScriptClient, type AgentConfig, type TokenResponse } from "@asgardeo/javascript";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import dotenv from "dotenv";
import { createBindingMessageAgent, createLlmModel, llmProvider } from "./llm.js";
import { createLogger } from "./logger.js";
import type { AgentRuntime, Flight } from "./models.js";
import {
    addSmartBindingMessages,
    findMatchingDealAlerts,
    getAgentTokenExpiresAtMs,
    getFlightFromPayload,
    getTokenPermissionClaims,
    getToolOrThrow,
    isExpiredTokenError,
    isRuntimeNearExpiry,
    isToolNamed,
    listDealAlertCandidates,
} from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const express = require("express") as (() => any) & {
    json: (options?: Record<string, unknown>) => unknown;
};

dotenv.config({
    path: resolve(__dirname, ".env"),
});

const logger = createLogger();
const defaultAgentScopes = "openid profile deal-alert-consents:read";
const port = Number(process.env.PORT || process.env.AGENT_PORT || 8790);
const host = process.env.HOST || "localhost";
const webhookPath = process.env.NEW_FLIGHT_WEBHOOK_PATH || process.env.DEAL_ALERT_WEBHOOK_PATH || "/deal-alerts";

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

type AsgardeoInternalAuth = {
    getSignInUrl: (requestConfig?: Record<string, unknown>, userId?: string) => Promise<string>;
};

let runtimePromise: Promise<AgentRuntime> | null = null;

async function getAgentTokenWithClientSecret(
    asgardeoJavaScriptClient: AsgardeoJavaScriptClient,
    config: typeof asgardeoConfig,
    agent: AgentConfig,
): Promise<TokenResponse> {
    if (!config.clientSecret.trim()) {
        return asgardeoJavaScriptClient.getAgentToken(agent);
    }

    const internalAuth = (asgardeoJavaScriptClient as unknown as { auth?: AsgardeoInternalAuth }).auth;

    if (!internalAuth?.getSignInUrl) {
        logger.warn("Asgardeo client internals changed; using getAgentToken without client_secret workaround");

        return asgardeoJavaScriptClient.getAgentToken(agent);
    }

    const originalGetSignInUrl = internalAuth.getSignInUrl;
    const boundGetSignInUrl = originalGetSignInUrl.bind(internalAuth);

    internalAuth.getSignInUrl = (requestConfig = {}, userId?: string) => boundGetSignInUrl({
        ...requestConfig,
        client_secret: true,
    }, userId);

    try {
        return await asgardeoJavaScriptClient.getAgentToken(agent);
    } finally {
        internalAuth.getSignInUrl = originalGetSignInUrl;
    }
}

async function createAIAgentRuntime() {
    logger.info("Starting Wayfinder ambient agent");

    const asgardeoJavaScriptClient = new AsgardeoJavaScriptClient(asgardeoConfig);
    const agentToken = await getAgentTokenWithClientSecret(asgardeoJavaScriptClient, asgardeoConfig, agentConfig);
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
    const tools = await client.getTools();
    const llmModel = createLlmModel();
    const bindingMessageAgent = createBindingMessageAgent(llmModel);

    logger.info({
        llmProvider,
        toolNames: tools.map((tool) => tool.name),
    }, "Loaded MCP tools and ReAct agent for ambient processing");

    return {
        bindingMessageAgent,
        client,
        llmModel,
        llmProvider,
        tokenExpiresAtMs,
        tools,
    };
}

async function getRuntime({ forceRefresh = false } = {}) {
    const existingRuntime = runtimePromise ? await runtimePromise : null;

    if (!forceRefresh && existingRuntime && !isRuntimeNearExpiry(existingRuntime)) {
        return existingRuntime;
    }

    if (existingRuntime) {
        await existingRuntime.client.close().catch((error: unknown) => {
            logger.warn({ err: error }, "Failed to close expired MCP client");
        });
    }

    runtimePromise = createAIAgentRuntime();

    return runtimePromise;
}

async function runWithFreshRuntime<T>(callback: (runtime: AgentRuntime) => Promise<T>) {
    try {
        return await callback(await getRuntime());
    } catch (error) {
        if (!isExpiredTokenError(error)) {
            throw error;
        }

        logger.warn({ err: error }, "Refreshing ambient agent runtime after token failure");

        return callback(await getRuntime({ forceRefresh: true }));
    }
}

async function processNewFlight(flight: Flight) {
    await runWithFreshRuntime(async (runtime) => {
        const candidates = await listDealAlertCandidates(runtime.tools);
        const matches = findMatchingDealAlerts(flight, candidates);

        logger.info({
            candidateCount: candidates.length,
            flightId: flight.id,
            matchCount: matches.length,
            routeFrom: flight.from,
            routeTo: flight.to,
        }, "Compared new flight with deal-alert consents");

        if (matches.length === 0) {
            return;
        }

        let matchesWithBindingMessages = matches;

        try {
            matchesWithBindingMessages = await addSmartBindingMessages(runtime.bindingMessageAgent, matches);
            logger.info({
                flightId: flight.id,
                matchCount: matchesWithBindingMessages.length,
            }, "Generated smart CIBA binding messages with ReAct agent");
        } catch (error) {
            logger.warn({
                err: error,
                flightId: flight.id,
                matchCount: matches.length,
            }, "Falling back to deterministic CIBA binding messages");
        }

        const processTool = getToolOrThrow(runtime.tools, "process_new_flight_deal_alerts");

        await processTool.invoke({ matches: matchesWithBindingMessages });
        logger.info({
            flightId: flight.id,
            matchCount: matches.length,
        }, "Initialized CIBA flows for matching deal alerts");
    });
}

async function handleNewFlightWebhook(payload: unknown, response: any) {
    const flight = getFlightFromPayload(payload);

    response.status(202).json({
        status: "accepted",
        flightId: flight.id,
    });

    void processNewFlight(flight).catch((error: unknown) => {
        logger.error({
            err: error,
            flightId: flight.id,
        }, "Error processing new-flight webhook");
    });
}

async function startServer() {
    await getRuntime();

    const app = express();

    app.use(express.json({ limit: "1mb" }));

    app.use((request: any, response: any, next: any) => {
        const requestId = randomUUID();
        const startedAt = performance.now();
        const requestLogger = logger.child({
            requestId,
            method: request.method,
            path: request.path,
        });

        request.requestId = requestId;
        request.requestLogger = requestLogger;
        response.setHeader("X-Request-Id", requestId);
        response.on("finish", () => {
            requestLogger.info({
                statusCode: response.statusCode,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
            }, "HTTP request completed");
        });
        requestLogger.info("HTTP request started");
        next();
    });

    app.get("/health", async (_request: any, response: any, next: any) => {
        try {
            const activeRuntime = await getRuntime();

            response.status(200).json({
                status: "ok",
                endpoint: webhookPath,
                llmProvider: activeRuntime.llmProvider,
                features: {
                    ambientFlightWebhook: true,
                    consentMatching: true,
                    cibaBatchTool: activeRuntime.tools.some((tool) => isToolNamed(tool, "process_new_flight_deal_alerts")),
                    consentListTool: activeRuntime.tools.some((tool) => isToolNamed(tool, "list_deal_alert_consents")),
                    reactBindingMessageAgent: true,
                    smartCibaBindingMessages: true,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    app.post(webhookPath, async (request: any, response: any) => {
        try {
            await handleNewFlightWebhook(request.body, response);
        } catch (error) {
            request.requestLogger?.warn({ err: error }, "Invalid new-flight webhook payload");
            response.status(400).json({
                error: error instanceof Error ? error.message : "Invalid new-flight payload.",
            });
        }
    });

    app.use((_request: any, response: any) => {
        response.status(404).json({ error: "Not found" });
    });

    app.use((error: any, request: any, response: any, _next: any) => {
        request.requestLogger?.error({ err: error }, "HTTP request failed");

        if (response.headersSent) {
            return;
        }

        const statusCode = error?.type === "entity.parse.failed" ? 400 : 500;

        response.status(statusCode).json({
            error: statusCode === 400 ? "Invalid JSON payload." : "Internal server error",
        });
    });

    app.listen(port, host, () => {
        logger.info({
            url: `http://${host}:${port}${webhookPath}`,
        }, "Wayfinder ambient agent listening");
    });
}

startServer().catch((error: unknown) => {
    logger.fatal({ err: error }, "Failed to start Wayfinder ambient agent");
    process.exitCode = 1;
});
