/**
 * Token Proximity-Based Smart Lock
 * SOEN 422 Embedded Systems and Software
 * Fall 2025 at Concordia University
 *
 * Smart Lock Controller (TTGO ESP32)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebServer.h> 
#include <ESPmDNS.h>   
#include <ESP32Servo.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

// --- CONFIGURATION ---
const char* WIFI_SSID = WIFI_SSID;
const char* WIFI_PASS = WIFI_PASS; 
const String SERVER_URL = SERVER_URL;
const String DOOR_ID = DOOR_ID; 

// PINS
#define PIN_SERVO 12
#define PIN_BUZZER 13
#define PIN_LIDAR_RX 32 
#define PIN_LIDAR_TX -1 // Unused

// OLED
#define OLED_SDA 21 
#define OLED_SCL 22 
#define OLED_RST 16 
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

// OBJECTS
Servo myservo;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RST); 
WebServer server(80); 

// STATE
int lastRSSI = 0;

// Declarations
int getRobustLidarDistance();
void handleUnlockRequest();
void handleNotFound();

void setup() {
  Serial.begin(115200);
  
  // Init LIDAR
  Serial2.begin(115200, SERIAL_8N1, PIN_LIDAR_RX, PIN_LIDAR_TX); 

  // Init Components
  myservo.attach(PIN_SERVO);
  myservo.write(0); 
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Init Display
  pinMode(OLED_RST, OUTPUT);
  digitalWrite(OLED_RST, LOW); delay(20);
  digitalWrite(OLED_RST, HIGH); delay(20);

  Wire.begin(OLED_SDA, OLED_SCL); 
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println("SSD1306 allocation failed");
  }
  display.setRotation(2); 
  display.setTextColor(WHITE);
  
  // Show Boot
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0,0);
  display.println("Booting Wi-Fi...");
  display.display();

  // CONNECT TO WI-FI
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin("smartlock")) {
    Serial.println("mDNS responder started");
  }

  // Local server for receiving access requests from phone app
  server.on("/unlock", HTTP_POST, handleUnlockRequest);
  server.onNotFound(handleNotFound);
  server.begin();
  
  showIdleScreen();
}

void loop() {
  server.handleClient();
}

// API HANDLER
void handleUnlockRequest() {
  if (!server.hasArg("plain")) { 
    server.send(400, "text/plain", "Body missing");
    return;
  }

  String body = server.arg("plain");
  Serial.println("Received Request: " + body);
  
  StaticJsonDocument<200> docIn;
  deserializeJson(docIn, body);
  String token = docIn["token"];
  
  if (token.length() != 18) {
      server.send(400, "application/json", "{\"error\":\"Invalid token format\"}");
      return;
  }

  // Gather Sensor Data
  Serial.println("Reading Sensors...");
  int distance = getRobustLidarDistance();
  Serial.print("LiDAR Result: "); Serial.println(distance);
  
  lastRSSI = WiFi.RSSI(); 
  
  display.clearDisplay();
  display.setCursor(0,0);
  display.setTextSize(1);
  display.println("Verifying...");
  display.print("RSSI: "); display.println(lastRSSI);
  display.print("Dist: "); display.println(distance);
  display.display();

  // Relay to Render server
  WiFiClientSecure client;
  client.setInsecure(); 
  HTTPClient http;
  
  http.begin(client, SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> docOut;
  docOut["token"] = token;
  docOut["rssi"] = lastRSSI;
  docOut["distanceCm"] = distance;
  docOut["doorId"] = DOOR_ID;
  
  String requestBody;
  serializeJson(docOut, requestBody);

  int httpCode = http.POST(requestBody);
  bool granted = false;
  String reason = "server_error";

  if (httpCode > 0) {
      String response = http.getString();
      StaticJsonDocument<200> respDoc;
      deserializeJson(respDoc, response);
      
      granted = respDoc["granted"];
      if (!granted) reason = respDoc["reason"].as<String>();
  } else {
      Serial.print("HTTP Fail: "); Serial.println(httpCode);
  }
  http.end();

  if (granted) {
      server.send(200, "application/json", "{\"status\":\"unlocked\"}");
      performUnlock();
  } else {
      server.send(403, "application/json", "{\"status\":\"denied\",\"reason\":\"" + reason + "\"}");
      performDeny(reason);
  }
  
  showIdleScreen();
}

void handleNotFound() {
  server.send(404, "text/plain", "Not Found");
}

void performUnlock() {
  Serial.println("ACCESS GRANTED");
  display.invertDisplay(true); 
  display.clearDisplay();
  display.setCursor(22, 25);
  display.setTextSize(2);
  display.println("GRANTED");
  display.setTextSize(1);
  display.setCursor(75, 55); 
  display.println("UNLOCKED");
  display.display();

  tone(PIN_BUZZER, 1000, 100); delay(100);
  tone(PIN_BUZZER, 1500, 100); delay(100);
  tone(PIN_BUZZER, 2000, 200); 

  myservo.write(90); 
  delay(5000);
  myservo.write(0); 
  display.invertDisplay(false); 
  tone(PIN_BUZZER, 500, 300);   
}

void performDeny(String reason) {
  Serial.println("ACCESS DENIED: " + reason);
  display.invertDisplay(false);
  display.clearDisplay();
  display.setCursor(20, 20);
  display.setTextSize(3);
  display.println("DENIED");
  display.setTextSize(1);
  display.setCursor(5, 50);
  
  if (reason == "rssi_too_weak") display.println("Weak Wi-Fi Signal");
  else if (reason == "distance_too_far") display.println("LiDAR: Too Far");
  else display.println("Invalid Token");
  
  display.setCursor(85, 0); 
  display.println("LOCKED");
  display.display();
  tone(PIN_BUZZER, 200, 1000); 
  delay(2000); 
}

void showIdleScreen() {
  display.invertDisplay(false); 
  display.clearDisplay();
  display.setTextSize(4);      
  display.setTextColor(WHITE);
  display.setCursor(28, 10);   
  display.println("968");
  display.setTextSize(1);
  display.setCursor(25, 55); 
  display.println("LOCKED");
  display.display();
}

int getRobustLidarDistance() {
  // Flush buffer
  while (Serial2.available() > 0) Serial2.read();
  
  // Wait for fresh data (Increased to 30ms)
  delay(30);
  
  // Read Loop (Increased timeout to 200ms to handle Wi-Fi jitter)
  unsigned long start = millis();
  while (millis() - start < 200) {
    if (Serial2.available() >= 9) {
      if (Serial2.read() == 0x59) {
         if (Serial2.peek() == 0x59) {
            Serial2.read(); // Consume 2nd 0x59
            int distL = Serial2.read();
            int distH = Serial2.read();
            for(int i=0; i<5; i++) Serial2.read(); // Consume remaining
            
            int dist = distL + (distH * 256);
            if(dist > 0 && dist < 1200) return dist;
         }
      }
    }
  }
  
  Serial.println("LiDAR TIMEOUT");
  return 999; 
}