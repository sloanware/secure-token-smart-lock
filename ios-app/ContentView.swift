import SwiftUI

struct ContentView: View {
    // COLORS
    let mainLavender = Color(red: 0.85, green: 0.80, blue: 0.95)
    let darkLavender = Color(red: 0.6, green: 0.55, blue: 0.8)
    let successGreen = Color(red: 0.1, green: 0.7, blue: 0.3)
    let wifiBlue     = Color(red: 0.2, green: 0.6, blue: 1.0)

    // STATE
    @State private var enrollmentToken = "ALICE_ENROLLMENT_TOKEN"
    
    // Services
    @StateObject private var api = APIService()
    @StateObject private var lockService = LocalLockService()
    
    // UI State flags
    @State private var isProcessing = false
    @State private var isConnecting = false
    @State private var isError = false
    @State private var errorMessage = "Error" // Holds specific denial reason
    @State private var isAccessGranted = false
    
    // Countdown State
    @State private var countdownSeconds: Int? = nil // Nil when not counting down
    @State private var countdownTimer: Timer? = nil

    // Input field state
    @State private var isEnrollExpanded = false
    
    var body: some View {
        ZStack {
            // BACKGROUND
            mainLavender
                .ignoresSafeArea()
                .onTapGesture {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    if isEnrollExpanded {
                        withAnimation { isEnrollExpanded = false }
                    }
                }

            // MAIN CONTENT
            VStack(spacing: 0) {
                
                // HEADER
                VStack(spacing: 15) {
                    Image(systemName: "lock.shield.fill")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 80, height: 80)
                        .foregroundColor(darkLavender)
                    
                    let titleFont = Font.custom("Futura-Bold", size: 34)
                    
                    ZStack {
                        Group {
                            Text("Smart Lock Client").offset(x:  2, y:  2)
                            Text("Smart Lock Client").offset(x: -1, y: -1)
                            Text("Smart Lock Client").offset(x: -1, y:  1)
                            Text("Smart Lock Client").offset(x:  1, y: -1)
                        }
                        .font(titleFont)
                        .foregroundColor(darkLavender)
                        
                        Text("Smart Lock Client")
                            .font(titleFont)
                            .foregroundColor(.white)
                    }
                }
                .padding(.top, 40)
                
                Spacer()
                
                // DYNAMIC ENROLL BUTTON / INPUT
                VStack {
                    if isEnrollExpanded {
                        TextField("Enter Enrollment Token", text: $enrollmentToken)
                            .padding()
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                            .foregroundColor(.black)
                            .frame(height: 50)
                            .background(Color.white)
                            .cornerRadius(25)
                            .overlay(
                                RoundedRectangle(cornerRadius: 25)
                                    .stroke(darkLavender, lineWidth: 2)
                            )
                            .padding(.horizontal, 40)
                        
                    } else {
                        Button(action: {
                            withAnimation(.spring()) { isEnrollExpanded = true }
                        }) {
                            Text("Enroll")
                                .font(.custom("Futura-Bold", size: 18))
                                .foregroundColor(darkLavender)
                                .padding(.horizontal, 30)
                                .padding(.vertical, 12)
                                .background(Color.white)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule().stroke(darkLavender, lineWidth: 2)
                                )
                                .shadow(color: Color.black.opacity(0.1), radius: 5, x: 0, y: 3)
                        }
                    }
                }
                .frame(height: 60)
                .padding(.bottom, 40)

                // MAIN CIRCULAR BUTTON
                Button(action: handleRequestAccess) {
                    let buttonFont = Font.custom("Futura-Bold", size: 22)
                    
                    ZStack {
                        // COUNTDOWN (Rate Limited)
                        if let seconds = countdownSeconds {
                            VStack(spacing: 10) {
                                Image(systemName: "timer")
                                    .font(.system(size: 60))
                                Text("Retry in \(seconds)s")
                                    .font(buttonFont)
                                    .multilineTextAlignment(.center)
                            }
                        }
                        
                        // PROCESSING (Getting Token from Server)
                        else if isProcessing && !isConnecting {
                            VStack(spacing: 10) {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(1.5)
                                Text("Authenticating...")
                                    .font(.caption)
                            }
                        }
                        
                        // ERROR
                        else if isError {
                            VStack(spacing: 10) {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 60))
                                Text(translateDenialReason(errorMessage)) // Simplified translation
                                    .font(buttonFont)
                                    .multilineTextAlignment(.center)
                            }
                        }
                        
                        // ACCESS GRANTED (Green Checkmark)
                        else if isAccessGranted {
                            VStack(spacing: 5) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 60))
                                    .padding(.bottom, 5)
                                
                                Text("Access Granted")
                                    .font(.custom("Futura-Bold", size: 20))
                                
                                Text("Door Unlocked")
                                    .font(.caption)
                                    .opacity(0.8)
                            }
                        }
                        
                        // CONNECTING (Wi-Fi Relay Mode)
                        else if isConnecting {
                            VStack(spacing: 10) {
                                Image(systemName: "wifi.circle.fill")
                                    .font(.system(size: 50))
                                Text("Connecting...")
                                    .font(.headline)
                                    .fontWeight(.bold)
                                Text("Contacting Door")
                                    .font(.caption)
                                    .opacity(0.8)
                            }
                        }
                        
                        // IDLE
                        else {
                            Text("Request\nAccess")
                                .font(buttonFont)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .frame(width: 240, height: 240)
                    .background(getButtonColor())
                    .clipShape(Circle())
                    .overlay(
                        Circle().stroke(Color.white, lineWidth: 5)
                    )
                    .shadow(color: Color.black.opacity(0.15), radius: 15, x: 0, y: 8)
                }
                // Disable button during processing, connecting, error, or countdown
                .foregroundColor(.white)
                .disabled(isProcessing || isAccessGranted || isConnecting || countdownSeconds != nil)
                
                Spacer()
                Spacer()
            }
        }
        // Watch for status changes from the Wi-Fi Service
        .onChange(of: lockService.statusMessage) { newMessage in
            handleStatusChange(message: newMessage)
        }
    }
    
    func getButtonColor() -> Color {
        if countdownSeconds != nil { return .orange.opacity(0.85) }
        if isProcessing && !isConnecting { return Color.gray }
        if isError { return Color.red.opacity(0.85) }
        if isAccessGranted { return successGreen }
        if isConnecting { return wifiBlue }
        return darkLavender
    }
    
    // Countdown Timer Logic
    func startCountdown(duration: TimeInterval) {
        // Clear any existing timer
        countdownTimer?.invalidate()
        let endTime = Date().addingTimeInterval(duration)
        
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { timer in
            let remaining = endTime.timeIntervalSinceNow
            
            if remaining <= 0 {
                timer.invalidate()
                DispatchQueue.main.async {
                    self.countdownSeconds = nil
                    self.isError = false
                    self.errorMessage = ""
                }
            } else {
                DispatchQueue.main.async {
                    self.countdownSeconds = Int(ceil(remaining))
                }
            }
        }
        self.countdownSeconds = Int(ceil(duration))
    }
    
    func handleRequestAccess() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        
        if isEnrollExpanded { withAnimation { isEnrollExpanded = false } }
        
        // Reset Logic
        if isError { isError = false; return }
        
        guard !enrollmentToken.isEmpty else {
            isError = true
            errorMessage = "Token Required"
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { isError = false }
            return
        }
        
        isProcessing = true
        
        // Request token from render
        api.requestAccess(enrollmentToken: enrollmentToken) { result in
            DispatchQueue.main.async {
                self.isProcessing = false
                
                switch result {
                case .success(let shortToken):
                    // Token received, start Wi-Fi relay
                    self.isConnecting = true
                    self.lockService.sendTokenToLock(token: shortToken)
                    
                case .failure(let error):
                    // API Error Handling
                    if let authError = error as? AuthError {
                        switch authError {
                        case .rateLimited:
                            self.errorMessage = "rate_limited"
                            self.isError = true
                            self.startCountdown(duration: 60) // Start 60-second cooldown
                        default:
                            // Covers invalidEnrollmentToken, serverError, and unknown
                            self.errorMessage = "generic_denial"
                            self.isError = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.isError = false }
                        }
                    } else {
                        // Generic network error
                        self.isError = true
                        self.errorMessage = "generic_denial"
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.isError = false }
                    }
                }
            }
        }
    }
    
    // Listens to the LocalLockService updates (After TTGO replies)
    func handleStatusChange(message: String) {
        if message.contains("SUCCESS") {
            // Door Unlocked
            self.isConnecting = false
            withAnimation { self.isAccessGranted = true }
            
            // Reset to Idle after 5 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                withAnimation { self.isAccessGranted = false }
            }
        }
        else if message.contains("DENIED") {
            // TTGO Denied Access (RSSI, LiDAR, or Token Invalid)
            self.isConnecting = false
            self.isError = true
            
            // Map all denials to generic "Access Denied" via translateDenialReason
            self.errorMessage = "generic_denial"
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.isError = false }
        }
        else if message.contains("Failed") || message.contains("Error") {
            // Network/System Error
            self.isConnecting = false
            self.isError = true
            self.errorMessage = "generic_denial" // Treated as Access Denied for simplicity
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.isError = false }
        }
    }
    
    // Translates internal error codes to user-friendly text for the circular button
    func translateDenialReason(_ code: String) -> String {
        if code == "rate_limited" {
            return "Rate Limited"
        } else {
            return "Access Denied"
        }
    }
}
