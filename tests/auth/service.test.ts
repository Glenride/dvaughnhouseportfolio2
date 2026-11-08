import { decodeJwt } from "jose";
import {
  signupUser,
  loginUser,
  refreshToken,
  logoutUser,
  requestPasswordReset,
  completePasswordReset,
  listUsers,
  disableUser,
  deleteUser,
  resetManagementTokenCache,
} from "../../backend/auth/service";
import { httpRequest, type HttpResponse } from "../../backend/auth/httpClient";
import { verifyAccessToken } from "../../backend/auth/jwksCache";
import { AuthServiceError } from "../../backend/auth/errors";
import { resetAuth0ConfigCache } from "../../backend/auth/config";

jest.mock("../../backend/auth/httpClient", () => ({
  httpRequest: jest.fn(),
}));

jest.mock("../../backend/auth/jwksCache", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("jose", () => ({
  decodeJwt: jest.fn(),
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn().mockResolvedValue({ payload: { sub: "user" } }),
}));

const httpRequestMock = httpRequest as jest.MockedFunction<typeof httpRequest>;
const verifyAccessTokenMock = verifyAccessToken as jest.MockedFunction<typeof verifyAccessToken>;
const decodeJwtMock = decodeJwt as jest.MockedFunction<typeof decodeJwt>;

type HttpResponseInput<T> = Partial<HttpResponse<T>> & { data: T };

function mockResponse<T>(input: HttpResponseInput<T>): HttpResponse<T> {
  return {
    status: input.status ?? 200,
    ok: input.ok ?? true,
    data: input.data,
    headers: (input.headers as Headers) ?? ({} as Headers),
  };
}

function seedEnv() {
  process.env.AUTH0_DOMAIN = "auth0.example.com";
  process.env.AUTH0_AUDIENCE_API = "https://api.example.com";
  process.env.AUTH0_CLIENT_ID_NATIVE = "native-client";
  process.env.AUTH0_CLIENT_SECRET_NATIVE = "native-secret";
  process.env.AUTH0_CLIENT_ID_M2M = "m2m-client";
  process.env.AUTH0_CLIENT_SECRET_M2M = "m2m-secret";
  process.env.AUTH0_DEFAULT_DB_CONNECTION = "Username-Password-Authentication";
  process.env.AUTH0_PASSWORD_RESET_REDIRECT_URL = "https://app.example.com/reset";
  process.env.AUTH0_ROLE_CLAIM = "https://example.com/roles";
  process.env.AUTH0_ADMIN_ROLE = "admin";
}

beforeEach(() => {
  seedEnv();
  resetAuth0ConfigCache();
  resetManagementTokenCache();
  jest.clearAllMocks();
  decodeJwtMock.mockReset();
  decodeJwtMock.mockReturnValue({ email_verified: true } as any);
});

describe("Auth service", () => {
  test("signupUser proxies to Auth0 signup endpoint", async () => {
    httpRequestMock.mockResolvedValueOnce(mockResponse({ data: { _id: "auth0|123" } }));

    const result = await signupUser({ email: "user@example.com", password: "P@ssw0rd" });

    expect(httpRequestMock).toHaveBeenCalledWith("https://auth0.example.com/dbconnections/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        client_id: "native-client",
        email: "user@example.com",
        password: "P@ssw0rd",
        connection: "Username-Password-Authentication",
        user_metadata: {},
      },
    });
    expect(result).toEqual({ _id: "auth0|123" });
  });

  test("loginUser enforces email verification", async () => {
    httpRequestMock.mockResolvedValueOnce(
      mockResponse({
        data: {
          access_token: "atk",
          refresh_token: "rtk",
          id_token: "idtk",
          expires_in: 3600,
          token_type: "Bearer",
        },
      })
    );
    decodeJwtMock.mockReturnValueOnce({ email_verified: false } as any);

    await expect(loginUser({ email: "user@example.com", password: "invalid" })).rejects.toThrow(
      new AuthServiceError("Email address not verified", 400, { email_verified: false })
    );
  });

  test("loginUser returns token bundle when verification passes", async () => {
    httpRequestMock.mockResolvedValueOnce(
      mockResponse({
        data: {
          access_token: "atk",
          refresh_token: "rtk",
          id_token: "idtk",
          expires_in: 3600,
          token_type: "Bearer",
        },
      })
    );

    const tokens = await loginUser({ email: "user@example.com", password: "secret" });
    expect(tokens.access_token).toBe("atk");
  });

  test("refreshToken proxies to Auth0 refresh flow", async () => {
    httpRequestMock.mockResolvedValueOnce(mockResponse({ data: { access_token: "new" } }));

    const response = await refreshToken("refresh-token");

    expect(httpRequestMock).toHaveBeenLastCalledWith("https://auth0.example.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        grant_type: "refresh_token",
        client_id: "native-client",
        client_secret: "native-secret",
        refresh_token: "refresh-token",
      },
    });
    expect(response.access_token).toBe("new");
  });

  test("logoutUser revokes refresh token", async () => {
    httpRequestMock.mockResolvedValueOnce(mockResponse({ data: { success: true } }));
    const response = await logoutUser("refresh-token");

    expect(httpRequestMock).toHaveBeenCalledWith("https://auth0.example.com/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        client_id: "native-client",
        client_secret: "native-secret",
        token: "refresh-token",
      },
    });
    expect(response.success).toBe(true);
  });

  test("requestPasswordReset returns ticket when user exists", async () => {
    httpRequestMock
      .mockResolvedValueOnce(
        mockResponse({
          data: {
            access_token: "mgmt",
            expires_in: 3600,
            token_type: "Bearer",
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          data: [{ user_id: "auth0|user" }],
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          data: { ticket: "https://reset" },
        })
      );

    const ticket = await requestPasswordReset({ email: "user@example.com" });
    expect(ticket.ticket).toBe("https://reset");
  });

  test("requestPasswordReset hides user existence", async () => {
    httpRequestMock
      .mockResolvedValueOnce(
        mockResponse({ data: { access_token: "mgmt", expires_in: 3600, token_type: "Bearer" } })
      )
      .mockResolvedValueOnce(mockResponse({ data: [] }));

    const ticket = await requestPasswordReset({ email: "missing@example.com" });
    expect(ticket.ticket).toBeNull();
  });

  test("completePasswordReset updates password via management API", async () => {
    httpRequestMock
      .mockResolvedValueOnce(
        mockResponse({ data: { access_token: "mgmt", expires_in: 3600, token_type: "Bearer" } })
      )
      .mockResolvedValueOnce(mockResponse({ data: { success: true } }));

    const result = await completePasswordReset({ user_id: "auth0|user", new_password: "NewP@ss" });
    expect(httpRequestMock).toHaveBeenLastCalledWith(
      "https://auth0.example.com/api/v2/users/auth0%7Cuser",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(result.success).toBe(true);
  });

  test("listUsers validates admin role before querying", async () => {
    verifyAccessTokenMock.mockResolvedValueOnce({ sub: "admin" } as any);
    httpRequestMock
      .mockResolvedValueOnce(
        mockResponse({ data: { access_token: "mgmt", expires_in: 3600, token_type: "Bearer" } })
      )
      .mockResolvedValueOnce(mockResponse({ data: [{ user_id: "auth0|123" }] }));

    const result = await listUsers("admin-token");
    expect(verifyAccessTokenMock).toHaveBeenCalledWith("admin-token", { requiredRoles: ["admin"] });
    expect(result).toEqual([{ user_id: "auth0|123" }]);
  });

  test("disableUser blocks user via management API", async () => {
    verifyAccessTokenMock.mockResolvedValueOnce({ sub: "admin" } as any);
    httpRequestMock
      .mockResolvedValueOnce(
        mockResponse({ data: { access_token: "mgmt", expires_in: 3600, token_type: "Bearer" } })
      )
      .mockResolvedValueOnce(mockResponse({ data: { user_id: "auth0|123", blocked: true } }));

    const result = await disableUser("auth0|123", "admin-token");
    expect(result).toEqual({ user_id: "auth0|123", blocked: true });
  });

  test("deleteUser removes account via management API", async () => {
    verifyAccessTokenMock.mockResolvedValueOnce({ sub: "admin" } as any);
    httpRequestMock
      .mockResolvedValueOnce(
        mockResponse({ data: { access_token: "mgmt", expires_in: 3600, token_type: "Bearer" } })
      )
      .mockResolvedValueOnce(mockResponse({ data: null }));

    const result = await deleteUser("auth0|123", "admin-token");
    expect(result.success).toBe(true);
  });
});
