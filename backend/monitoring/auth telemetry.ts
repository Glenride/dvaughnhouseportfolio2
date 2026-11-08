import { getManagementToken } from "../auth/service";
import { httpRequest } from "../auth/httpClient";
import { loadAuth0Config } from "../auth/config";

export async function fetchAuth0Logs(from: string, take = 50) {
  const token = await getManagementToken();
  const config = loadAuth0Config();
  const response = await httpRequest(
    `${config.baseUrl}/api/v2/logs?from=${encodeURIComponent(from)}&take=${take}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  return response.data;
}

export async function ingestLogsToDatadog(logs: unknown[]): Promise<void> {
  const apiKey = process.env.DATADOG_API_KEY;
  if (!apiKey) {
    throw new Error("DATADOG_API_KEY is required");
  }

  const body = logs.map((event) => ({
    ddsource: "auth0",
    ddtags: "service:auth,env:" + (process.env.NODE_ENV ?? "development"),
    message: JSON.stringify(event),
    additional: event,
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
