import Foundation
#if canImport(Auth0)
import Auth0
#endif
#if canImport(JWTDecode)
import JWTDecode
#endif

public struct AuthConfiguration {
    public let domain: String
    public let clientId: String
    public let audience: String
    public let scope: String

    public init(domain: String, clientId: String, audience: String, scope: String = "openid profile email offline_access") {
        self.domain = domain
        self.clientId = clientId
        self.audience = audience
        self.scope = scope
    }
}

public enum AuthServiceError: Error, Equatable {
    case authenticationFailed(String)
    case emailNotVerified
    case refreshFailed(String)
    case logoutFailed(String)
    case credentialsUnavailable
}

public protocol AuthenticationPerforming {
    func login(email: String, password: String, audience: String, scope: String, completion: @escaping (Result<Credentials, Error>) -> Void)
    func renew(refreshToken: String, scope: String, completion: @escaping (Result<Credentials, Error>) -> Void)
    func revoke(refreshToken: String, completion: @escaping (Result<Void, Error>) -> Void)
}

public protocol CredentialsManaging {
    func store(credentials: Credentials) -> Bool
    func credentials() -> Credentials?
    func clear() -> Bool
}

#if canImport(Auth0)
extension CredentialsManager: CredentialsManaging {}

extension Authentication: AuthenticationPerforming {
    public func login(email: String, password: String, audience: String, scope: String, completion: @escaping (Result<Credentials, Error>) -> Void) {
        self.login(
            emailOrUsername: email,
            password: password,
            realmOrConnection: "Username-Password-Authentication",
            audience: audience,
            scope: scope
        ).start { result in
            switch result {
            case .success(let credentials):
                completion(.success(credentials))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    public func renew(refreshToken: String, scope: String, completion: @escaping (Result<Credentials, Error>) -> Void) {
        self.renew(withRefreshToken: refreshToken, scope: scope).start { result in
            switch result {
            case .success(let credentials):
                completion(.success(credentials))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    public func revoke(refreshToken: String, completion: @escaping (Result<Void, Error>) -> Void) {
        self.revoke(refreshToken).start { result in
            switch result {
            case .success:
                completion(.success(()))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }
}
#endif

public final class AuthService {
    private let config: AuthConfiguration
    private let authentication: AuthenticationPerforming
    private let credentialsManager: CredentialsManaging
    private let emailVerificationClaim = "email_verified"

    public init(
        config: AuthConfiguration,
        authentication: AuthenticationPerforming,
        credentialsManager: CredentialsManaging
    ) {
        self.config = config
        self.authentication = authentication
        self.credentialsManager = credentialsManager
    }

    #if canImport(Auth0)
    public convenience init(config: AuthConfiguration) {
        let auth = Auth0.authentication(clientId: config.clientId, domain: config.domain)
        let storage = CredentialsManager(authentication: auth)
        self.init(config: config, authentication: auth, credentialsManager: storage)
    }
    #endif

    public func login(email: String, password: String, completion: @escaping (Result<Credentials, AuthServiceError>) -> Void) {
        authentication.login(email: email, password: password, audience: config.audience, scope: config.scope) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let credentials):
                if self.isEmailVerified(credentials: credentials) {
                    _ = self.credentialsManager.store(credentials: credentials)
                    completion(.success(credentials))
                } else {
                    completion(.failure(.emailNotVerified))
                }
            case .failure(let error):
                completion(.failure(.authenticationFailed(error.localizedDescription)))
            }
        }
    }

    public func renewCredentials(completion: @escaping (Result<Credentials, AuthServiceError>) -> Void) {
        guard let existing = credentialsManager.credentials(), let refreshToken = existing.refreshToken else {
            completion(.failure(.credentialsUnavailable))
            return
        }

        authentication.renew(refreshToken: refreshToken, scope: config.scope) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let credentials):
                _ = self.credentialsManager.store(credentials: credentials)
                completion(.success(credentials))
            case .failure(let error):
                completion(.failure(.refreshFailed(error.localizedDescription)))
            }
        }
    }

    public func currentCredentials() -> Credentials? {
        return credentialsManager.credentials()
    }

    public func logout(completion: @escaping (Result<Void, AuthServiceError>) -> Void) {
        guard let refreshToken = credentialsManager.credentials()?.refreshToken else {
            _ = credentialsManager.clear()
            completion(.success(()))
            return
        }

        authentication.revoke(refreshToken: refreshToken) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                _ = self.credentialsManager.clear()
                completion(.success(()))
            case .failure(let error):
                completion(.failure(.logoutFailed(error.localizedDescription)))
            }
        }
    }

    private func isEmailVerified(credentials: Credentials) -> Bool {
        guard let idToken = credentials.idToken else { return false }
        #if canImport(JWTDecode)
        do {
            let jwt = try decode(jwt: idToken)
            if let verified = jwt.claim(name: emailVerificationClaim).boolean {
                return verified
            }
            return false
        } catch {
            return false
        }
        #else
        return true
        #endif
    }
}
