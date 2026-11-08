import { getManagementToken } from "../auth/service";
import { httpRequest } from "../auth/httpClient";
import { loadAuth0Config } from "../auth/config";

export interface Auth0LogEvent {
  _id: string;
  date: string;
  type: string;
  description?: string;
  details?: {
    stats?: {
      log_id?: string;
      queue_time?: number;
      processing_time?: number;
    };
    request?: {
      method?: string;
      path?: string;
      geoip?: {
        country_code?: string;
      };
      body?: Record<string, unknown>;
    };
  };
}

export interface AuthTelemetrySummary {
  loginSuccess: number;
  loginFailure: number;
  passwordResetSuccess: number;
  passwordResetFailure: number;
  tokenLatencyP95: number | null;
  totalLogins: number;
}

const LOGIN_SUCCESS_EVENT_TYPES = new Set(["s", "ss", "sc", "seacft"]);
const LOGIN_FAILURE_EVENT_TYPES = new Set(["f", "fs", "fr", "fv", "fp", "fc"]);
const PASSWORD_RESET_SUCCESS_TYPES = new Set(["sapi", "scp", "seccp", "pse"]);
const PASSWORD_RESET_FAILURE_TYPES = new Set(["fpw", "fpr", "fcpr", "frpf"]);

export function summarizeAuthMetrics(logs: Auth0LogEvent[]): AuthTelemetrySummary {
  let loginSuccess = 0;
  let loginFailure = 0;
  let passwordResetSuccess = 0;
  let passwordResetFailure = 0;
  const tokenLatencies: number[] = [];

  for (const log of logs) {
    if (LOGIN_SUCCESS_EVENT_TYPES.has(log.type)) {
      loginSuccess += 1;
    } else if (LOGIN_FAILURE_EVENT_TYPES.has(log.type)) {
      loginFailure += 1;
    }

    if (PASSWORD_RESET_SUCCESS_TYPES.has(log.type)) {
      passwordResetSuccess += 1;
    } else if (PASSWORD_RESET_FAILURE_TYPES.has(log.type)) {
      passwordResetFailure += 1;
    }

    const processingTime = log.details?.stats?.processing_time;
    if (typeof processingTime === "number" && processingTime >= 0) {
      tokenLatencies.push(processingTime);
    }
  }

  tokenLatencies.sort((a, b) => a - b);
  const p95Index = tokenLatencies.length
    ? Math.min(tokenLatencies.length - 1, Math.floor(0.95 * tokenLatencies.length))
    : null;
  const tokenLatencyP95 = p95Index !== null ? tokenLatencies[p95Index] : null;

  return {
    loginSuccess,
    loginFailure,
    passwordResetSuccess,
    passwordResetFailure,
    tokenLatencyP95,
    totalLogins: loginSuccess + loginFailure,
  };
}

export interface DatadogMetric {
  metric: string;
  type: "gauge" | "count" | "rate";
  value: number;
  tags: string[];
}

export function buildDatadogMetrics(summary: AuthTelemetrySummary, tags: string[] = []): DatadogMetric[] {
  const metrics: DatadogMetric[] = [
    { metric: "auth.login.success_count", type: "count", value: summary.loginSuccess, tags },
    { metric: "auth.login.failure_count", type: "count", value: summary.loginFailure, tags },
    {
      metric: "auth.password_reset.success_count",
      type: "count",
      value: summary.passwordResetSuccess,
      tags,
    },
    {
      metric: "auth.password_reset.failure_count",
      type: "count",
      value: summary.passwordResetFailure,
      tags,
    },
  ];

  if (summary.totalLogins > 0) {
    metrics.push({
      metric: "auth.login.failure_rate",
      type: "gauge",
      value: summary.loginFailure / summary.totalLogins,
      tags,
    });
  }

  if (summary.passwordResetSuccess + summary.passwordResetFailure > 0) {
    metrics.push({
      metric: "auth.password_reset.error_rate",
      type: "gauge",
      value:
        summary.passwordResetFailure /
        (summary.passwordResetSuccess + summary.passwordResetFailure),
      tags,
    });
  }

  if (summary.tokenLatencyP95 !== null) {
    metrics.push({
      metric: "auth.token.issuance_latency_p95",
      type: "gauge",
      value: summary.tokenLatencyP95,
      tags,
    });
  }

  return metrics;
}

async function fetchAuth0Logs(from: string, take = 100): Promise<Auth0LogEvent[]> {
  const config = loadAuth0Config();
  const token = await getManagementToken();
  const response = await httpRequest<Auth0LogEvent[]>(
    `${config.baseUrl}/api/v2/logs?from=${encodeURIComponent(from)}&take=${take}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return Array.isArray(response.data) ? response.data : [];
}

async function sendMetricsToDatadog(metrics: DatadogMetric[]): Promise<void> {
  if (!metrics.length) {
    return;
  }

  const apiKey = process.env.DATADOG_API_KEY;
  if (!apiKey) {
    throw new Error("DATADOG_API_KEY is required to publish metrics");
  }

  const applicationKey = process.env.DATADOG_APPLICATION_KEY;
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    series: metrics.map((metric) => ({
      metric: metric.metric,
      type: metric.type,
      points: [[timestamp, metric.value]],
      tags: metric.tags,
    })),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "DD-API-KEY": apiKey,
  };

  if (applicationKey) {
    headers["DD-APPLICATION-KEY"] = applicationKey;
  }

  await httpRequest("https://api.datadoghq.com/api/v1/series", {
    method: "POST",
    headers,
    body,
  });
}

async function forwardLogsToDatadog(logs: Auth0LogEvent[]): Promise<void> {
  if (!logs.length) {
    return;
  }

  const apiKey = process.env.DATADOG_API_KEY;
  if (!apiKey) {
    throw new Error("DATADOG_API_KEY is required to forward logs");
  }

  const body = logs.map((event) => ({
    ddsource: "auth0",
    ddtags: [
      `service:auth`,
      `env:${process.env.NODE_ENV ?? "development"}`,
      `event_type:${event.type}`,
    ].join(","),
    message: JSON.stringify(event),
    timestamp: Math.floor(new Date(event.date).getTime() / 1000),
  }));

  await httpRequest("https://http-intake.logs.datadoghq.com/api/v2/logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "DD-API-KEY": apiKey,
    },
    body,
  });
}

export interface CollectTelemetryOptions {
  from: string;
  take?: number;
  tags?: string[];
  forwardRawLogs?: boolean;
}

export async function collectAndPublishAuthTelemetry(options: CollectTelemetryOptions): Promise<void> {
  const logs = await fetchAuth0Logs(options.from, options.take ?? 100);
  if (options.forwardRawLogs) {
    await forwardLogsToDatadog(logs);
  }

  const summary = summarizeAuthMetrics(logs);
  const tags = options.tags ?? [`env:${process.env.NODE_ENV ?? "development"}`];
  const metrics = buildDatadogMetrics(summary, tags);
  await sendMetricsToDatadog(metrics);
}

export async function syncAuth0Logs(from: string, take = 100): Promise<void> {
  const logs = await fetchAuth0Logs(from, take);
  await forwardLogsToDatadog(logs);
}
