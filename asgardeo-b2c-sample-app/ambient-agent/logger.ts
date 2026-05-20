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

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50,
};

type LogContext = Record<string, unknown>;

function normalizeLogLevel(value: string | undefined): LogLevel {
    return value === "debug" || value === "info" || value === "warn" || value === "error" || value === "fatal"
        ? value
        : "info";
}

function summarizeError(error: Error) {
    const errorLike = error as Error & {
        code?: string;
        statusCode?: number;
        statusText?: string;
    };
    const collapsedMessage = error.message.replace(/\s+/g, " ");
    const truncatedMessage = collapsedMessage.length > 500
        ? `${collapsedMessage.slice(0, 500)}...`
        : collapsedMessage;

    return [
        error.name,
        errorLike.code,
        errorLike.statusCode ? `status=${errorLike.statusCode}` : "",
        errorLike.statusText,
        truncatedMessage,
    ].filter(Boolean).join(" ");
}

function redactLogValue(key: string, value: unknown): unknown {
    if (
        key.toLowerCase().includes("authorization") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("secret")
    ) {
        return "[redacted]";
    }

    if (value instanceof Error) {
        return summarizeError(value);
    }

    return value;
}

function formatLogContext(context: LogContext) {
    const entries = Object.entries(context)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => {
            const redactedValue = redactLogValue(key, value);
            const formattedValue = typeof redactedValue === "string"
                ? redactedValue.replace(/\s+/g, " ")
                : JSON.stringify(redactedValue);

            return `${key}=${formattedValue}`;
        });

    return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}

export function createLogger(context: LogContext = {}) {
    const configuredLevel = normalizeLogLevel(process.env.LOG_LEVEL);

    function write(level: LogLevel, first: string | LogContext, second?: string) {
        if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[configuredLevel]) {
            return;
        }

        const message = typeof first === "string" ? first : second || "";
        const childContext = typeof first === "string" ? {} : first;
        const timestamp = new Date().toISOString();
        const contextText = formatLogContext({ ...context, ...childContext });
        const line = `${timestamp} ${level.toUpperCase()} ${message}${contextText}`;

        if (level === "warn") {
            console.warn(line);
        } else if (level === "error" || level === "fatal") {
            console.error(line);
        } else {
            console.log(line);
        }
    }

    return {
        child: (childContext: LogContext) => createLogger({ ...context, ...childContext }),
        debug: (first: string | LogContext, second?: string) => write("debug", first, second),
        error: (first: string | LogContext, second?: string) => write("error", first, second),
        fatal: (first: string | LogContext, second?: string) => write("fatal", first, second),
        info: (first: string | LogContext, second?: string) => write("info", first, second),
        warn: (first: string | LogContext, second?: string) => write("warn", first, second),
    };
}
