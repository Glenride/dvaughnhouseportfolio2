import { decodeJwt } from "jose";
import { loadAuth0Config } from "./config";
import { httpRequest } from "./httpClient";
import { AuthServiceError, ensureSuccess } from "./errors";
import { verifyAccessToken } from "./jwksCache";

interface SignupPayload {
  email: string;
  password: string;
  user_metadata?: Record<string, unknown>;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in: number;
  token_type: string;
}

interface PasswordResetRequestPayload {
  email: string;
}

interface PasswordResetCompletePayload {
  user_id: string;
  new_password: string;
}

interface PasswordResetResult {
  ticket: string | null;
}

interface ManagementTokenCache {
  accessToken: string;
  expiresAt: number;
}

let managementTokenCache: ManagementTokenCache | null = null;

const MANAGEMENT_TOKEN_TTL_SKEW = 60; // seconds

async function fetchManagementToken(): Promise<string> {
  const config = loadAuth0Config();
  const response = await httpRequest<TokenResponse>(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      grant_type: "client_credentials",
      client_id: config.clientIdM2M,
      client_secret: config.clientSecretM2M,
      audience: `${config.baseUrl}/api/v2/`,
    },
  });

  ensureSuccess(response, "Fetch management token");
  const now = Math.floor(Date.now() / 1000);
  managementTokenCache = {
    accessToken: response.data.access_token,
    expiresAt: now + response.data.expires_in - MANAGEMENT_TOKEN_TTL_SKEW,
  };
  return managementTokenCache.accessToken;
}

export async function getManagementToken(): Promise<string> {
  if (
    managementTokenCache &&
    managementTokenCache.expiresAt > Math.floor(Date.now() / 1000)
  ) {
    return managementTokenCache.accessToken;
  }

  return fetchManagementToken();
}

export async function signupUser(payload: SignupPayload) {
  const config = loadAuth0Config();
  const response = await httpRequest(`${config.baseUrl}/dbconnections/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      client_id: config.clientIdNative,
      email: payload.email,
      password: payload.password,
      connection: config.defaultDbConnection,
      user_metadata: payload.user_metadata ?? {},
    },
  });

  ensureSuccess(response, "Signup user");
  return response.data;
}

export async function loginUser(payload: LoginPayload) {
  const config = loadAuth0Config();
  const response = await httpRequest<TokenResponse>(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      client_id: config.clientIdNative,
      client_secret: config.clientSecretNative,
      audience: config.audienceApi,
      scope: "openid profile email offline_access",
      username: payload.email,
      password: payload.password,
      realm: config.defaultDbConnection,
    },
  });

  ensureSuccess(response, "Login user");

  if (!response.data.id_token) {
    throw new AuthServiceError("Login response missing id_token", 502, response.data);
  }

  const idPayload = decodeJwt(response.data.id_token);
  if (!idPayload.email_verified) {
    throw new AuthServiceError("Email address not verified", 400, {
      email_verified: idPayload.email_verified,
    });
  }

  return response.data;
}

export async function refreshToken(refreshToken: string) {
  const config = loadAuth0Config();
  const response = await httpRequest<TokenResponse>(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      grant_type: "refresh_token",
      client_id: config.clientIdNative,
      client_secret: config.clientSecretNative,
      refresh_token: refreshToken,
    },
  });

  ensureSuccess(response, "Refresh token");
  return response.data;
}

export async function logoutUser(refreshToken: string) {
  const config = loadAuth0Config();
  const response = await httpRequest(`${config.baseUrl}/oauth/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      client_id: config.clientIdNative,
      client_secret: config.clientSecretNative,
      token: refreshToken,
    },
  });

  ensureSuccess(response, "Revoke refresh token");
  return { success: true };
}

export async function requestPasswordReset(payload: PasswordResetRequestPayload): Promise<PasswordResetResult> {
  const config = loadAuth0Config();
  const managementToken = await getManagementToken();

  // Lookup user to acquire user_id for ticket generation
  const usersResponse = await httpRequest<{ users: Array<{ user_id: string }> }>(
    `${config.baseUrl}/api/v2/users-by-email?email=${encodeURIComponent(payload.email)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${managementToken}`,
      },
    }
  );

  ensureSuccess(usersResponse, "Lookup user by email");
  const user = Array.isArray(usersResponse.data)
    ? usersResponse.data[0]
    : (usersResponse.data.users?.[0] as { user_id: string } | undefined);

  if (!user) {
    // For security, do not reveal user existence
    return { ticket: null };
  }

  const ticketResponse = await httpRequest<{ ticket: string }>(
    `${config.baseUrl}/api/v2/tickets/password-change`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${managementToken}`,
      },
      body: {
        user_id: user.user_id,
        result_url: config.passwordResetRedirectUrl,
        mark_email_as_verified: true,
      },
    }
  );

  ensureSuccess(ticketResponse, "Create password reset ticket");
  return { ticket: ticketResponse.data.ticket };
}

export async function completePasswordReset(payload: PasswordResetCompletePayload) {
  const config = loadAuth0Config();
  const managementToken = await getManagementToken();

  const response = await httpRequest(`${config.baseUrl}/api/v2/users/${encodeURIComponent(payload.user_id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${managementToken}`,
    },
    body: {
      password: payload.new_password,
      verify_password: true,
    },
  });

  ensureSuccess(response, "Complete password reset");
  return { success: true };
}

export async function listUsers(accessToken: string) {
  await verifyAccessToken(accessToken, { requiredRoles: [loadAuth0Config().adminRole] });
  const managementToken = await getManagementToken();
  const config = loadAuth0Config();

  const response = await httpRequest(`${config.baseUrl}/api/v2/users`, {
    headers: {
      Authorization: `Bearer ${managementToken}`,
    },
  });

  ensureSuccess(response, "List users");
  return response.data;
}

export async function disableUser(userId: string, accessToken: string) {
  await verifyAccessToken(accessToken, { requiredRoles: [loadAuth0Config().adminRole] });
  const managementToken = await getManagementToken();
  const config = loadAuth0Config();

  const response = await httpRequest(`${config.baseUrl}/api/v2/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${managementToken}`,
    },
    body: {
      blocked: true,
    },
  });

  ensureSuccess(response, "Disable user");
  return response.data;
}

export async function deleteUser(userId: string, accessToken: string) {
  await verifyAccessToken(accessToken, { requiredRoles: [loadAuth0Config().adminRole] });
  const managementToken = await getManagementToken();
  const config = loadAuth0Config();

  const response = await httpRequest(`${config.baseUrl}/api/v2/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${managementToken}`,
    },
  });

  ensureSuccess(response, "Delete user");
  return { success: true };
}

export function resetManagementTokenCache() {
  managementTokenCache = null;
}
