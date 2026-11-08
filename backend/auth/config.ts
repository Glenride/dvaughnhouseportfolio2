export interface Auth0Config {
  environment: string;
  domain: string;
  baseUrl: string;
  issuer: string;
  audienceApi: string;
  clientIdNative: string;
  clientSecretNative: string;
  clientIdM2M: string;
  clientSecretM2M: string;
  defaultDbConnection: string;
  passwordResetRedirectUrl: string;
  roleClaim: string;
  adminRole: string;
}

let cachedConfig: Auth0Config | null = null;

function requireEnvVar(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadAuth0Config(): Auth0Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const environment = process.env.NODE_ENV ?? "development";
  const domain = requireEnvVar("AUTH0_DOMAIN");
  const normalizedDomain = domain.replace(/^https?:\/\//, "");
  const baseUrl = `https://${normalizedDomain}`;
  const issuer = `${baseUrl}/`; // Auth0 issuer ends with trailing slash

  cachedConfig = {
    environment,
    domain: normalizedDomain,
    baseUrl,
    issuer,
    audienceApi: requireEnvVar("AUTH0_AUDIENCE_API"),
    clientIdNative: requireEnvVar("AUTH0_CLIENT_ID_NATIVE"),
    clientSecretNative: requireEnvVar("AUTH0_CLIENT_SECRET_NATIVE"),
    clientIdM2M: requireEnvVar("AUTH0_CLIENT_ID_M2M"),
    clientSecretM2M: requireEnvVar("AUTH0_CLIENT_SECRET_M2M"),
    defaultDbConnection: requireEnvVar(
      "AUTH0_DEFAULT_DB_CONNECTION",
      "Username-Password-Authentication"
    ),
    passwordResetRedirectUrl: requireEnvVar(
      "AUTH0_PASSWORD_RESET_REDIRECT_URL",
      "https://dvh.example.com/password-reset/success"
    ),
    roleClaim: requireEnvVar(
      "AUTH0_ROLE_CLAIM",
      "https://dvh.example.com/roles"
    ),
    adminRole: requireEnvVar("AUTH0_ADMIN_ROLE", "admin"),
  };

  return cachedConfig;
}

export function resetAuth0ConfigCache(): void {
  cachedConfig = null;
}
