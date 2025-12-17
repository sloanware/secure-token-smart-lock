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
#include <NimBLEDevice.h>
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

// --- PINS ---
#define PIN_SERVO 12
#define PIN_BUZZER 13
#define PIN_LIDAR_RX 25
#define PIN_LIDAR_TX -1 

// OLED Pins
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_RST 16
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

// --- OBJECTS ---
Servo myservo;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RST);
NimBLEScan* pBLEScan;

// --- STATE ---
bool isScanning = true;
String foundToken = "";
int foundRSSI = 0;

// Forward Declaration
int getRobustLidarDistance();

void setup() {
  Serial.begin(115200);
  
  // Init LIDAR
  Serial2.begin(115200, SERIAL_8N1, PIN_LIDAR_RX, PIN_LIDAR_TX); 

  // Init Components
  myservo.attach(PIN_SERVO);
  myservo.write(0); // Start Locked
  
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Init Display (Hardware Reset for TTGO)
  pinMode(OLED_RST, OUTPUT);
  digitalWrite(OLED_RST, LOW); delay(20);
  digitalWrite(OLED_RST, HIGH); delay(20);

  Wire.begin(OLED_SDA, OLED_SCL);
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println("SSD1306 allocation failed");
  }
  display.setRotation(2); // Rotates 180 degrees
  display.setTextColor(WHITE);
  
  // Show Boot
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0,0);
  display.println("System Booting...");
  display.display();

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");

  // Init BLE
  NimBLEDevice::init("");
  pBLEScan = NimBLEDevice::getScan();
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);
}

void loop() {
  if (isScanning) {
    showIdleScreen(); 
    
    // 1. Start scan (1 second)
    pBLEScan->start(1, false); 
    
    // 2. Get results
    NimBLEScanResults foundDevices = pBLEScan->getResults(); 
    
    for(int i=0; i<foundDevices.getCount(); i++) {
      const NimBLEAdvertisedDevice* device = foundDevices.getDevice(i);
      String name = device->getName().c_str();
      
      // Look for our specific token length (18 chars)
      if (name.length() == 18) {
        Serial.print("Found Token: ");
        Serial.println(name);
        
        foundToken = name;
        foundRSSI = device->getRSSI();
        
        isScanning = false; 
        pBLEScan->stop();
        break; 
      }
    }
    pBLEScan->clearResults(); 
  } 
  else {
    processAccessRequest();
    
    // Cooldown before scanning again
    delay(2000);
    isScanning = true;
  }
}

// Displays big "968"
void showIdleScreen() {
  display.invertDisplay(false); // Ensure normal colors
  display.clearDisplay();
  
  // Room Number
  display.setTextSize(4);      
  display.setTextColor(WHITE);
  display.setCursor(28, 10);   
  display.println("968");
  
  // Status in Corner (Small)
  display.setTextSize(1);
  display.setCursor(85, 55); // Bottom Right
  display.println("LOCKED");
  
  display.display();
}

void processAccessRequest() {
  // --- ROBUST LIDAR READ ---
  int distance = getRobustLidarDistance();
  
  display.clearDisplay();
  display.setCursor(0,0);
  display.setTextSize(1);
  display.println("Verifying Access...");
  
  display.print("RSSI: "); display.println(foundRSSI);
  display.print("Dist: "); 
  if(distance == 999) display.println("Error/Far");
  else { display.print(distance); display.println(" cm"); }
  
  display.display();

  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure client;
    client.setInsecure(); 
    HTTPClient http;
    
    http.begin(client, SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<200> doc;
    doc["token"] = foundToken;
    doc["rssi"] = foundRSSI;
    doc["distanceCm"] = distance;
    doc["doorId"] = DOOR_ID;
    
    String requestBody;
    serializeJson(doc, requestBody);

    int httpResponseCode = http.POST(requestBody);
    
    if (httpResponseCode > 0) {
      String response = http.getString();
      StaticJsonDocument<200> respDoc;
      deserializeJson(respDoc, response);
      
      bool granted = respDoc["granted"];
      String reason = respDoc["reason"];

      if (granted) {
        performUnlock();
      } else {
        performDeny(reason);
      }
    } else {
      showStatus("Server Error");
      delay(2000);
    }
    http.end();
  } else {
    showStatus("WiFi Lost");
    delay(1000);
  }
}

void performUnlock() {
  Serial.println("ACCESS GRANTED");
  
  // --- VISUAL: INVERT DISPLAY (Simulates Green/Active) ---
  display.invertDisplay(true); 
  display.clearDisplay();
  
  // Big Status
  display.setCursor(10, 20);
  display.setTextSize(3);
  display.println("GRANTED");

  // Small Status in Corner
  display.setTextSize(1);
  display.setCursor(75, 55); 
  display.println("UNLOCKED");
  
  display.display();

  // --- AUDIO: Happy Tones ---
  tone(PIN_BUZZER, 1000, 100); delay(100);
  tone(PIN_BUZZER, 1500, 100); delay(100);
  tone(PIN_BUZZER, 2000, 200); 

  // --- ACTION: Unlock ---
  myservo.write(90); 

  // --- WAIT: 5 Seconds (No Countdown) ---
  delay(5000);

  // --- RESET ---
  myservo.write(0); // Lock
  display.invertDisplay(false); // Back to normal colors
  tone(PIN_BUZZER, 500, 300);   // Lock tone
}

void performDeny(String reason) {
  Serial.println("ACCESS DENIED: " + reason);

  // --- VISUAL: NORMAL DISPLAY (Simulates Red/Error) ---
  display.invertDisplay(false);
  display.clearDisplay();
  
  // Big Status
  display.setCursor(20, 20);
  display.setTextSize(3);
  display.println("DENIED");
  
  // Reason Text
  display.setTextSize(1);
  display.setCursor(5, 50);
  if (reason == "rssi_too_weak") display.println("Move Closer");
  else if (reason == "distance_too_far") display.println("LiDAR: Too Far");
  else display.println("Invalid Token");
  
  // Status in Corner
  display.setCursor(85, 0); 
  display.println("LOCKED");

  display.display();

  // --- AUDIO: Sad Tone ---
  tone(PIN_BUZZER, 200, 1000); 
  delay(2000); 
}

// -----------------------------------------------------------
//  ROBUST LIDAR FUNCTION
// -----------------------------------------------------------
int getRobustLidarDistance() {
  // 1. FLUSH BUFFER
  while (Serial2.available() > 0) {
    Serial2.read();
  }

  // 2. WAIT FOR FRESH DATA
  delay(25);

  // 3. READ A PACKET
  unsigned long start = millis();
  while (millis() - start < 50) {
    if (Serial2.available() >= 9) {
      if (Serial2.read() == 0x59) {
        if (Serial2.peek() == 0x59) {
          Serial2.read(); // Consume 2nd header
          
          int distL = Serial2.read();
          int distH = Serial2.read();
          int strL  = Serial2.read();
          int strH  = Serial2.read();
          int tempL = Serial2.read();
          int tempH = Serial2.read();
          int checksum = Serial2.read();
          
          long sum = 0x59 + 0x59 + distL + distH + strL + strH + tempL + tempH;
          if ((sum & 0xFF) == checksum) {
            int newDist = distL + (distH * 256);
            if (newDist > 0 && newDist < 1200) {
               return newDist; 
            }
          }
        }
      }
    }
  }
  return 999; // Return safe value (too far) on failure
}

void showStatus(String msg) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(0, 0);
  display.println(msg);
  display.display();
}