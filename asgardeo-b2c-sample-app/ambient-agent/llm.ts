import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

export type LlmProvider = "gemini" | "openai" | "claude" | "deepseek";

export const llmProvider = (process.env.LLM_PROVIDER || "gemini").toLowerCase() as LlmProvider;

export function createLlmModel() {
    switch (llmProvider) {
        case "openai":
            return new ChatOpenAI({
                apiKey: process.env.OPENAI_API_KEY || "",
                model: process.env.MODEL_NAME || "gpt-4o",
            });
        case "claude":
            return new ChatAnthropic({
                apiKey: process.env.ANTHROPIC_API_KEY || "",
                model: process.env.MODEL_NAME || "claude-opus-4-7",
            });
        case "deepseek":
            return new ChatOpenAI({
                apiKey: process.env.DEEPSEEK_API_KEY || "",
                model: process.env.MODEL_NAME || "deepseek-chat",
                configuration: {
                    baseURL: "https://api.deepseek.com/v1",
                },
            });
        default:
            return new ChatGoogleGenerativeAI({
                apiKey: process.env.GOOGLE_API_KEY || "",
                model: process.env.MODEL_NAME || "gemini-2.5-flash",
            });
    }
}

export type LlmModel = ReturnType<typeof createLlmModel>;

export const bindingMessageAgentPrompt = [
    "You are Wayfinder's ambient CIBA message agent.",
    "Your only job is to write concise CIBA binding messages for better-flight approval requests.",
    "Do not call tools. Do not make booking decisions. Do not invent facts.",
    "Use only the supplied JSON data.",
    "Each message must clearly state the route, airline if present, departure time/date if present, new price, savings if present, and that the existing booking will be canceled if approved.",
    "Never include booking IDs, consent IDs, auth request IDs, access tokens, or raw technical identifiers.",
    "Keep each bindingMessage under 220 characters.",
    "Return only valid JSON in this exact shape: {\"messages\":[{\"bookingId\":\"...\",\"bindingMessage\":\"...\"}]}",
].join("\n");

export function createBindingMessageAgent(llmModel: LlmModel) {
    return createReactAgent({
        llm: llmModel,
        tools: [],
        prompt: bindingMessageAgentPrompt,
    });
}

export type BindingMessageAgent = ReturnType<typeof createBindingMessageAgent>;
