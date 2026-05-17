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

function createLogger(context: LogContext = {}) {
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

export type Logger = ReturnType<typeof createLogger>;

export function getStartTime() {
    return performance.now();
}

export function getDurationMs(startedAt: number) {
    return Number((performance.now() - startedAt).toFixed(1));
}

export function getLogPath(path: string, baseUrl: string) {
    try {
        const url = new URL(path, baseUrl);

        return `${url.pathname}${url.search}`;
    } catch {
        return path;
    }
}

export async function logOperation<T>({
    args,
    context,
    durationLabel = "durationMs",
    logger: operationLogger,
    operation,
    startedMessage,
    completedMessage,
    failedMessage,
    summarizeArgs,
}: {
    args?: Record<string, unknown>;
    context?: LogContext;
    durationLabel?: string;
    logger: Logger;
    operation: () => Promise<T>;
    startedMessage: string;
    completedMessage: string;
    failedMessage: string;
    summarizeArgs?: (args: Record<string, unknown>) => unknown;
}): Promise<T> {
    const startedAt = performance.now();
    const scopedLogger = context ? operationLogger.child(context) : operationLogger;
    const summarizedArgs = args
        ? summarizeArgs
            ? summarizeArgs(args)
            : args
        : undefined;

    scopedLogger.info({
        args: summarizedArgs,
    }, startedMessage);

    try {
        const result = await operation();

        scopedLogger.info({
            [durationLabel]: getDurationMs(startedAt),
        }, completedMessage);

        return result;
    } catch (error) {
        scopedLogger.error({
            [durationLabel]: getDurationMs(startedAt),
            err: error,
        }, failedMessage);

        throw error;
    }
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>) {
    if (toolName === "process_new_flight_deal_alerts") {
        return {
            matchCount: Array.isArray(args.matches) ? args.matches.length : 0,
        };
    }

    if (toolName === "store_deal_alert_consent") {
        return {
            bookingId: args.bookingId,
            routeFrom: args.routeFrom,
            routeTo: args.routeTo,
            enabled: args.enabled,
            hasCriteria: Boolean(args.criteria),
        };
    }

    return args;
}

export function logToolOperation<T>(
    requestLogger: Logger,
    toolName: string,
    args: Record<string, unknown>,
    operation: () => Promise<T>,
): Promise<T> {
    return logOperation({
        args,
        context: { toolName },
        logger: requestLogger,
        operation,
        startedMessage: "MCP tool call started",
        completedMessage: "MCP tool call completed",
        failedMessage: "MCP tool call failed",
        summarizeArgs: (toolArgs) => summarizeToolArgs(toolName, toolArgs),
    });
}

export const logger = createLogger();
