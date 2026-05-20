import type { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { BindingMessageAgent, LlmModel, LlmProvider } from "./llm.js";

export type JsonObject = Record<string, unknown>;

export type Flight = {
    id: string;
    from: string;
    to: string;
    airline?: string;
    departureTime?: string;
    arrivalTime?: string;
    duration?: string;
    stops?: number;
    price: number;
    currency?: string;
    cabin?: string;
    dates?: string;
    tags?: string[];
};

export type DealAlertConsent = {
    id?: string;
    bookingId: string;
    username: string;
    routeFrom: string;
    routeTo: string;
    criteria?: JsonObject;
    enabled?: boolean;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type DealAlertCandidate = {
    consent: DealAlertConsent;
    currentPrice: number;
    currentCabin?: string | null;
    currentDates?: string | null;
    currentDepartureTime?: string | null;
    currency?: string | null;
    travelers?: number | null;
    userId?: string | null;
};

export type DealAlertMatch = DealAlertCandidate & {
    newFlight: Flight;
    bindingMessage?: string;
};

export type ToolWithSchema = {
    name?: string;
    invoke?: (input: any) => Promise<unknown> | unknown;
};

export type AgentRuntime = {
    bindingMessageAgent: BindingMessageAgent;
    client: MultiServerMCPClient;
    llmModel: LlmModel;
    llmProvider: LlmProvider;
    tokenExpiresAtMs: number;
    tools: ToolWithSchema[];
};
