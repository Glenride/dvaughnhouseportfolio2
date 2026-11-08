import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";
import { loadAuth0Config } from "./config";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let lastFetchedAt = 0;
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getRemoteJwks() {
  const config = loadAuth0Config();
  if (!remoteJwks || Date.now() - lastFetchedAt > JWKS_CACHE_TTL_MS) {
    remoteJwks = createRemoteJWKSet(new URL(`${config.baseUrl}/.well-known/jwks.json`));
    lastFetchedAt = Date.now();
  }
  return remoteJwks;
}

export interface VerifyTokenOptions {
  audience?: string;
  requiredRoles?: string[];
}

export async function verifyAccessToken(token: string, options: VerifyTokenOptions = {}): Promise<JWTPayload> {
  const config = loadAuth0Config();
  const jwks = getRemoteJwks();

  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: options.audience ?? config.audienceApi,
  });

  if (options.requiredRoles?.length) {
    const rolesClaim = payload[config.roleClaim];
    const payloadRoles = Array.isArray(rolesClaim) ? rolesClaim : [];
    const missingRoles = options.requiredRoles.filter((role) => !payloadRoles.includes(role));
    if (missingRoles.length > 0) {
      throw new Error(`Token missing required roles: ${missingRoles.join(", ")}`);
    }
  }

  return payload;
}
