import Foundation

class LocalLockService: ObservableObject {
    
    // The mDNS URL defined in your TTGO code (MDNS.begin("smartlock"))
    // Note: If mDNS acts up on specific router, replace this with the IP printed in Serial Monitor.
    private let lockURL = "http://smartlock.local/unlock"
    
    @Published var statusMessage = "Ready to connect"

    func sendTokenToLock(token: String) {
        guard let url = URL(string: lockURL) else {
            self.statusMessage = "Error: Invalid URL"
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10 // Give the TTGO time to process

        // JSON Body: { "token": "..." }
        let body: [String: String] = ["token": token]
        
        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            self.statusMessage = "Error: Failed to encode JSON"
            return
        }

        print("Local: Sending token to \(lockURL)...")
        self.statusMessage = "Contacting Door..."

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    print("Local: Network Error - \(error.localizedDescription)")
                    self?.statusMessage = "Failed: Is you connected to the Hotspot?"
                    return
                }

                if let httpResponse = response as? HTTPURLResponse {
                    if httpResponse.statusCode == 200 {
                        print("Local: Success! Door Unlocked.")
                        self?.statusMessage = "SUCCESS: Door Unlocked"
                    } else if httpResponse.statusCode == 403 {
                        print("Local: Door Denied Access.")
                        self?.statusMessage = "DENIED: Lock rejected token"
                    } else {
                        print("Local: Unknown Server Error \(httpResponse.statusCode)")
                        self?.statusMessage = "Error: Server code \(httpResponse.statusCode)"
                    }
                }
            }
        }.resume()
    }
}
