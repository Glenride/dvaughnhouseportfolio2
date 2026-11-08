#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_KEYS = ["API_URL", "API_KEY"];

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) {
    return;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const entry of lines) {
    const trimmed = entry.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    if (!REQUIRED_KEYS.includes(key) || process.env[key]) {
      continue;
    }
    const value = trimmed.slice(idx + 1).trim();
    process.env[key] = value;
  }
}

function ensureEnv() {
  loadDotEnv();
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error("Missing env vars: " + missing.join(", "));
    process.exit(1);
  }
}

function normalize(url) {
  const withProto = url.startsWith("http") ? url : "https://" + url;
  return withProto.endsWith("/") ? withProto : withProto + "/";
}

async function main() {
  ensureEnv();
  const base = normalize(process.env.API_URL);
  const query = process.argv[2] ?? "react";
  const endpoint = new URL("search", base);
  endpoint.searchParams.set("query", query);

  const res = await fetch(endpoint, {
    headers: {
      Authorization: "Bearer " + process.env.API_KEY,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Request failed (" + res.status + " " + res.statusText + ")\n" + body);
    process.exit(1);
  }

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];

  console.log("Successfully connected to Context7 API.");
  console.log(
    JSON.stringify(
      {
        query,
        endpoint: endpoint.toString(),
        resultCount: results.length,
        sample: results.slice(0, 5),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Unexpected error while contacting Context7 API:", error);
  process.exit(1);
});
