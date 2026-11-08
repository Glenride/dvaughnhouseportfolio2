import { buildDatadogMetrics, summarizeAuthMetrics, type Auth0LogEvent } from "../../backend/monitoring/authTelemetry";

describe("auth telemetry", () => {
  const baseLog = {
    _id: "id",
    date: new Date().toISOString(),
    type: "s",
  } as Auth0LogEvent;

  test("summarizeAuthMetrics aggregates counts and latency", () => {
    const logs: Auth0LogEvent[] = [
      baseLog,
      { ...baseLog, type: "f" },
      { ...baseLog, type: "pse" },
      { ...baseLog, type: "fpw" },
      {
        ...baseLog,
        type: "s",
        details: { stats: { processing_time: 120 } },
      },
    ];

    const summary = summarizeAuthMetrics(logs);
    expect(summary.loginSuccess).toBe(2);
    expect(summary.loginFailure).toBe(1);
    expect(summary.passwordResetSuccess).toBe(1);
    expect(summary.passwordResetFailure).toBe(1);
    expect(summary.tokenLatencyP95).toBe(120);
  });

  test("buildDatadogMetrics calculates rates", () => {
    const summary = {
      loginSuccess: 8,
      loginFailure: 2,
      passwordResetSuccess: 4,
      passwordResetFailure: 1,
      tokenLatencyP95: 200,
      totalLogins: 10,
    };

    const metrics = buildDatadogMetrics(summary, ["env:test"]);
    const failureRate = metrics.find((m) => m.metric === "auth.login.failure_rate");
    expect(failureRate?.value).toBeCloseTo(0.2);

    const resetRate = metrics.find((m) => m.metric === "auth.password_reset.error_rate");
    expect(resetRate?.value).toBeCloseTo(0.2);

    const latency = metrics.find((m) => m.metric === "auth.token.issuance_latency_p95");
    expect(latency?.value).toBe(200);
  });
});
