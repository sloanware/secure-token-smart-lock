# Secure Token Proximity-Based Smart Lock

### Overview

This is a fourth year Software Engineering (B.ENG) project at Concordia University. Our goal was to design and implement a prototype of an IoT embedded system under the theme of "Smart Campus".<br>

The prototype must be connected to the Internet, and must include various communicating systems, sensors and actuators.

### The Problem

In university, computer science and engineering labs, art studios, offices, or any authorized room must be available outside scheduled hours so students and employees can work, but providing secure, convenient access can be difficult. Current doors rely on a shared numeric keypad code that is emailed or posted each term. These codes are easily copied, shared, or forgotten, require administrators to change them on each keypad, and are vulnerable to simple attacks such as shoulder-surfing, social engineering, and guessing. Also, there is no centralized logging, and no simple way to revoke access for individuals in real time. These weaknesses create both usability problems for legitimate students and security risks for the multitude of expensive equipment or tech.

### The Solution

Replacing the numeric keypad with a secure token, proximity-based smart lock. This access control system is comprised of three communicating systems:

- TTGO ESP32 microcontroller as the door controller, equipped with Wi-Fi, an OLED display, a piezo buzzer, and a LIDAR sensor for precise distance measurement
- A lightweight mobile application with a "Request Access" functionality
- A server for generating and validating long-lived and short-lived tokens, storing user data, logging, and request access logic.

### Design and Architecture

The app stores a long-lived token in secure storage, named here an "enrollment token", issued and verified by the server at the start of the semester. This enrollment token serves as proof that the app belongs to a valid, enrolled student. When the student presses “Request Access”, the app makes a HTTPS request to the server for a short-lived random token. The server validates the enrollment token and student permissions, generates a short-lived anonymous token, and returns it to the app. The app then sends the short-lived token to the door controller over a local network. When received, the door controller measures the signal strength (RSSI) and uses its LIDAR sensor to confirm the user is physically within close range of the door. The door controller then sends the short lived token, its door ID and its sensor measurements to the server via Wi-Fi. The server validates the token and the proximity data and, if valid, sends back an authorization to unlock. The door controller then actuates a servo motor to release the door latch, and it provides feedback through the OLED display and buzzer.

This design removes the need for codes or logins, preserves student privacy by using anonymous short-lived tokens, and allows administrators to revoke access instantly or let tokens expire automatically. LIDAR-based distance measurements and RSSI readings ensure that only users physically present at the door with their device can unlock it. Also, most poeple are very protective of their cell phones and normally have a passcode, preventing misuse if stolen.

### Future Improvements

Keep note that this is a prototype, and in a real-world production setting, further security implementations would be required:

- Token hashing
- Secure administration of enrollment tokens (either through physical validation with student ID at an admin or IT office, or institution login with the university's identity provider on the app)
- Secure logs (no details of student ID or enrollment token logged on the server console)
- Maximum number of devices per enrollment token
- Complete obfuscation of enrollment token (the user or admin never actually sees the enrollment token nor manipulates it)

Also, power outtage, server down or network delay would need to be considered. Two possible offline solutions are a TTGO token cache or public-private key pair fallback.

### Demo

https://github.com/user-attachments/assets/a44900ed-36ff-4c1f-b8e1-7c0a34f33dd7

### Functional Diagram

![Functional Diagram SmartLock](https://github.com/user-attachments/assets/2a94a667-25d9-4d43-b570-281875e4db85)

### Further Details

**Firmware**: C++ (Arduino)<br>
**Server**: Node.js (Express), SQLite<br>
**iOS App**: Swift, SwiftUI<br>

|             |                                              |
| :---------- | :------------------------------------------- |
| Author      | **sloanware (AKA Sarah Papadopoli)**         |
| Course      | **Embedded Systems and Software (SOEN 422)** |
| Date        | **Fall 2025**                                |
| Prof        | **Dr. Hakim Mellah**                         |
| Department  | **Engineering and Computer Science**         |
| Institution | **Concordia University**                     |
| Location    | **Montreal, Canada**                         |
