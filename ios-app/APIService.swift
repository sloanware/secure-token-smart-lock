import Foundation
import Combine

// CUSTOM ERROR DEFINITION
enum AuthError: Error {
    case rateLimited
    case invalidEnrollmentToken
    case serverError(Int) // For 500-level errors
    case unknown
}

// Response Models
struct TokenResponse: Decodable {
    let token: String
    let expiresAt: Int64
}

// Struct for error responses from the server on failure
struct ErrorResponse: Decodable {
    let error: String? // Used when status code is 4xx
}

struct StatusResponse: Decodable {
    let status: String
}

class APIService: ObservableObject {
    
    let baseURL = Secrets.serverURL
    
    // Request Short Token
    func requestAccess(enrollmentToken: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/request-token") else {
            completion(.failure(AuthError.unknown))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: String] = ["enrollmentToken": enrollmentToken]
        request.httpBody = try? JSONEncoder().encode(body)
        
        print("API: Requesting token for \(enrollmentToken)...")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse else {
                completion(.failure(AuthError.unknown))
                return
            }
            
            guard let data = data else {
                 completion(.failure(AuthError.unknown))
                 return
            }
            
            // CHECK HTTP STATUS CODE FOR DENIALS
            if httpResponse.statusCode == 200 {
                // SUCCESS: Proceed to decode the token
                do {
                    let result = try JSONDecoder().decode(TokenResponse.self, from: data)
                    print("API: Received short token: \(result.token)")
                    completion(.success(result.token))
                } catch {
                    print("API: Failed to decode success response")
                    completion(.failure(error))
                }
            } else {
                // FAILURE: Analyze the status code
                
                // 429: Too Many Requests (Rate Limit)
                if httpResponse.statusCode == 429 {
                    completion(.failure(AuthError.rateLimited))
                    return
                }
                
                // 403: Forbidden (Invalid/Expired Enrollment Token)
                if httpResponse.statusCode == 403 {
                    completion(.failure(AuthError.invalidEnrollmentToken))
                    return
                }
                
                // 5xx: Server Errors
                if httpResponse.statusCode >= 500 {
                    completion(.failure(AuthError.serverError(httpResponse.statusCode)))
                    return
                }
                
                // Other unexpected failures
                completion(.failure(AuthError.unknown))
            }
        }.resume()
    }
    
    // Check Status from server (if TTGO is unresponsive)
    func checkStatus(token: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/check-status?token=\(token)") else { return }
        
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else { return }
            
            do {
                let result = try JSONDecoder().decode(StatusResponse.self, from: data)
                completion(.success(result.status))
            } catch {
                print("API: Failed to decode status response")
                completion(.failure(error))
            }
        }.resume()
    }
}
