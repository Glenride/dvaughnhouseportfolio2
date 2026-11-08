import XCTest
@testable import AuthServiceModule

final class MockAuthentication: AuthenticationPerforming {
    var loginResult: Result<Credentials, Error> = .failure(NSError(domain: "", code: -1))
    var renewResult: Result<Credentials, Error> = .failure(NSError(domain: "", code: -1))
    var revokeResult: Result<Void, Error> = .failure(NSError(domain: "", code: -1))

    func login(email: String, password: String, audience: String, scope: String, completion: @escaping (Result<Credentials, Error>) -> Void) {
        completion(loginResult)
    }

    func renew(refreshToken: String, scope: String, completion: @escaping (Result<Credentials, Error>) -> Void) {
        completion(renewResult)
    }

    func revoke(refreshToken: String, completion: @escaping (Result<Void, Error>) -> Void) {
        completion(revokeResult)
    }
}

final class MockCredentialsManager: CredentialsManaging {
    var storedCredentials: Credentials?
    var storeCalled = false
    var clearCalled = false

    func store(credentials: Credentials) -> Bool {
        storeCalled = true
        storedCredentials = credentials
        return true
    }

    func credentials() -> Credentials? {
        return storedCredentials
    }

    func clear() -> Bool {
        clearCalled = true
        storedCredentials = nil
        return true
    }
}

final class AuthServiceTests: XCTestCase {
    let config = AuthConfiguration(domain: "example.auth0.com", clientId: "client", audience: "https://api.example.com")

    func testLoginSuccessStoresCredentials() {
        let authentication = MockAuthentication()
        let credentials = Credentials(accessToken: "atk", tokenType: "Bearer", idToken: nil, refreshToken: "rtk", expiresIn: Date().addingTimeInterval(3600))
        authentication.loginResult = .success(credentials)
        let manager = MockCredentialsManager()
        let service = AuthService(config: config, authentication: authentication, credentialsManager: manager)

        let expectation = self.expectation(description: "Login")
        service.login(email: "user@example.com", password: "password") { result in
            if case .success(let stored) = result {
                XCTAssertEqual(stored.accessToken, "atk")
                XCTAssertTrue(manager.storeCalled)
            } else {
                XCTFail("Expected success")
            }
            expectation.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func testLoginFailureReturnsError() {
        let authentication = MockAuthentication()
        authentication.loginResult = .failure(NSError(domain: "", code: 401, userInfo: [NSLocalizedDescriptionKey: "Invalid credentials"]))
        let manager = MockCredentialsManager()
        let service = AuthService(config: config, authentication: authentication, credentialsManager: manager)

        let expectation = self.expectation(description: "Login")
        service.login(email: "user@example.com", password: "password") { result in
            if case .failure(let error) = result {
                XCTAssertEqual(error, .authenticationFailed("Invalid credentials"))
            } else {
                XCTFail("Expected failure")
            }
            expectation.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func testRenewCredentialsUsesRefreshToken() {
        let authentication = MockAuthentication()
        let initial = Credentials(accessToken: "atk", tokenType: "Bearer", idToken: nil, refreshToken: "rtk", expiresIn: Date().addingTimeInterval(3600))
        let refreshed = Credentials(accessToken: "new", tokenType: "Bearer", idToken: nil, refreshToken: "rtk", expiresIn: Date().addingTimeInterval(7200))
        authentication.renewResult = .success(refreshed)

        let manager = MockCredentialsManager()
        manager.storedCredentials = initial
        let service = AuthService(config: config, authentication: authentication, credentialsManager: manager)

        let expectation = self.expectation(description: "Renew")
        service.renewCredentials { result in
            if case .success(let stored) = result {
                XCTAssertEqual(stored.accessToken, "new")
                XCTAssertTrue(manager.storeCalled)
            } else {
                XCTFail("Expected success")
            }
            expectation.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func testLogoutClearsCredentials() {
        let authentication = MockAuthentication()
        authentication.revokeResult = .success(())
        let manager = MockCredentialsManager()
        manager.storedCredentials = Credentials(accessToken: "atk", tokenType: "Bearer", idToken: nil, refreshToken: "rtk", expiresIn: Date().addingTimeInterval(3600))
        let service = AuthService(config: config, authentication: authentication, credentialsManager: manager)

        let expectation = self.expectation(description: "Logout")
        service.logout { result in
            if case .success = result {
                XCTAssertTrue(manager.clearCalled)
                XCTAssertNil(manager.storedCredentials)
            } else {
                XCTFail("Expected success")
            }
            expectation.fulfill()
        }
        waitForExpectations(timeout: 1)
    }
}
