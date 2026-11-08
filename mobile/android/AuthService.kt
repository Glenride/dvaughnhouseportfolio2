package com.dvh.auth

import android.content.Context
import com.auth0.android.Auth0
import com.auth0.android.authentication.AuthenticationAPIClient
import com.auth0.android.result.Credentials
import com.auth0.android.result.UserProfile
import com.auth0.android.jwt.JWT
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.lang.Exception

sealed class AuthServiceError(message: String) : Exception(message) {
    class AuthenticationFailed(message: String) : AuthServiceError(message)
    object EmailNotVerified : AuthServiceError("Email not verified")
    class RefreshFailed(message: String) : AuthServiceError(message)
    class LogoutFailed(message: String) : AuthServiceError(message)
    object CredentialsUnavailable : AuthServiceError("Credentials unavailable")
}

data class AuthConfiguration(
    val domain: String,
    val clientId: String,
    val audience: String,
    val scope: String = "openid profile email offline_access"
)

data class AuthResult(
    val credentials: Credentials,
    val profile: UserProfile?
)

interface CredentialsRepository {
    suspend fun store(credentials: Credentials)
    suspend fun get(): Credentials?
    suspend fun clear()
}

class SharedPreferencesCredentialsRepository(
    context: Context,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) : CredentialsRepository {
    private val prefs = context.getSharedPreferences("auth_credentials", Context.MODE_PRIVATE)

    override suspend fun store(credentials: Credentials) = withContext(dispatcher) {
        prefs.edit()
            .putString("access_token", credentials.accessToken)
            .putString("id_token", credentials.idToken)
            .putString("refresh_token", credentials.refreshToken)
            .putLong("expires_at", credentials.expiresAt ?: 0)
            .apply()
    }

    override suspend fun get(): Credentials? = withContext(dispatcher) {
        val accessToken = prefs.getString("access_token", null) ?: return@withContext null
        val idToken = prefs.getString("id_token", null)
        val refreshToken = prefs.getString("refresh_token", null)
        val expiresAt = prefs.getLong("expires_at", 0)
        Credentials(accessToken, idToken, tokenType = "Bearer", refreshToken = refreshToken, expiresAt = expiresAt)
    }

    override suspend fun clear() = withContext(dispatcher) {
        prefs.edit().clear().apply()
    }
}

class AuthService(
    private val config: AuthConfiguration,
    private val client: AuthenticationAPIClient,
    private val credentialsRepository: CredentialsRepository,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) {
    private val emailVerificationClaim = "email_verified"

    companion object {
        fun create(
            context: Context,
            config: AuthConfiguration,
            dispatcher: CoroutineDispatcher = Dispatchers.IO
        ): AuthService {
            val auth0 = Auth0(config.clientId, config.domain)
            val client = AuthenticationAPIClient(auth0)
            val repo = SharedPreferencesCredentialsRepository(context, dispatcher)
            return AuthService(config, client, repo, dispatcher)
        }
    }

    suspend fun login(email: String, password: String): AuthResult = withContext(dispatcher) {
        try {
            val credentials = client.login(email, password, "Username-Password-Authentication")
                .setAudience(config.audience)
                .setScope(config.scope)
                .execute()

            if (!isEmailVerified(credentials)) {
                throw AuthServiceError.EmailNotVerified
            }

            credentialsRepository.store(credentials)

            val profile = credentials.idToken?.let { client.userInfo(credentials.accessToken).execute() }
            AuthResult(credentials, profile)
        } catch (ex: Exception) {
            throw AuthServiceError.AuthenticationFailed(ex.localizedMessage ?: "Unknown error")
        }
    }

    suspend fun refresh(): Credentials = withContext(dispatcher) {
        val current = credentialsRepository.get() ?: throw AuthServiceError.CredentialsUnavailable
        val refreshToken = current.refreshToken ?: throw AuthServiceError.CredentialsUnavailable

        try {
            val refreshed = client.renewAuth(refreshToken)
                .setScope(config.scope)
                .execute()
            credentialsRepository.store(refreshed)
            refreshed
        } catch (ex: Exception) {
            throw AuthServiceError.RefreshFailed(ex.localizedMessage ?: "Unknown error")
        }
    }

    suspend fun logout() = withContext(dispatcher) {
        val current = credentialsRepository.get()
        val refreshToken = current?.refreshToken

        try {
            if (refreshToken != null) {
                client.revokeToken(refreshToken).execute()
            }
        } catch (ex: Exception) {
            throw AuthServiceError.LogoutFailed(ex.localizedMessage ?: "Unknown error")
        } finally {
            credentialsRepository.clear()
        }
    }

    suspend fun currentCredentials(): Credentials? = withContext(dispatcher) {
        credentialsRepository.get()
    }

    private fun isEmailVerified(credentials: Credentials): Boolean {
        val idToken = credentials.idToken ?: return false
        return try {
            val jwt = JWT(idToken)
            jwt.getClaim(emailVerificationClaim).asBoolean() ?: false
        } catch (ex: Exception) {
            false
        }
    }
}
