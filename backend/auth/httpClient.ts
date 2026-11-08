const DEFAULT_TIMEOUT_MS = 8000;

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

function serializeBody(body: unknown): { serialized: string | undefined; headers: Record<string, string> } {
  if (body === undefined || body === null) {
    return { serialized: undefined, headers: {} };
  }

  if (typeof body === "string" || body instanceof URLSearchParams) {
    return { serialized: body.toString(), headers: {} };
  }

  return {
    serialized: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}

export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const { serialized, headers: contentHeaders } = serializeBody(options.body);
    const headers = { ...(options.headers ?? {}), ...contentHeaders };

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: serialized,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown = text;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch (error) {
        throw new Error(`Failed to parse JSON response from ${url}: ${(error as Error).message}`);
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      data: data as T,
      headers: response.headers,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
