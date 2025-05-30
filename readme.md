# Web-Based Control Interface for PTZ Camera and Robotic Platform

This project provides a web interface to:
1.  Control Pan-Tilt-Zoom (PTZ) functions of ONVIF-compliant IP cameras and view their RTSP video stream.
2.  Control a robotic platform (e.g., ESP32-based) via WebSocket communication.

It consists of a Python Flask backend (for camera interaction and video transcoding) and an HTML/JavaScript/CSS frontend (for the user interface and direct platform control). The interface is styled to resemble a Heads-Up Display (HUD) or drone control panel.

## Features

* **Integrated Web Interface:** Control both the camera and a robotic platform from a single web page with a modern HUD-style layout.
* **Camera PTZ Control:** Pan, Tilt, Zoom In, Zoom Out, and Stop commands for ONVIF cameras.
* **Robotic Platform Control:**
    * Real-time control via WebSocket connection to an ESP32 (or similar microcontroller).
    * Keyboard control for throttle (W/S) and steering (A/D).
    * Handbrake functionality (Spacebar).
    * Visual feedback for throttle, steering, and connection status.
* **Keyboard Shortcuts:**
    * Camera PTZ: Arrow keys, Z/X for zoom.
    * Platform: W, A, S, D for movement, Spacebar for handbrake.
* **RTSP to MJPEG Streaming:** View the camera's RTSP video stream directly in the browser (transcoded to MJPEG by the backend), serving as the background for the HUD.
* **ONVIF Communication (Camera):**
    * Sends ONVIF SOAP requests for PTZ control.
    * Supports WS-Security UsernameToken Profile for authentication.
* **Multi-Camera Type Support:** Pre-configured settings for specific camera types (e.g., YOOSEE, YCC365, Y05).
* **Configurable Settings:** Set camera IP, RTSP URL, ONVIF credentials, camera type, and platform IP through a modal configuration panel in the UI.
* **Visual Feedback:**
    * HUD-style interface with video as background.
    * Loader animation during requests.
    * Real-time logging area.
    * Platform connection status and telemetry.
* **CORS Handled:** Backend uses `Flask-CORS` for camera API requests. ESP32 WebSocket server also configured for CORS.

## Tech Stack

* **Backend (Camera & Video):**
    * Python 3
    * Flask (web framework)
    * OpenCV (`opencv-python`) (for RTSP stream capture and MJPEG encoding)
    * Requests (for sending ONVIF HTTP requests)
    * Flask-CORS (for handling Cross-Origin Resource Sharing)
* **Frontend:**
    * HTML5
    * JavaScript (ES6+)
    * Tailwind CSS (for styling, via CDN)
    * Custom CSS for HUD styling.
* **Platform (Microcontroller - Example):**
    * ESP32
    * Arduino C/C++
    * ESPAsyncWebServer & AsyncTCP (for WebSocket server)
    * ArduinoJson (for WebSocket message parsing/serialization)

## Project Structure (Illustrative)

```
PROJECT_ROOT/
├── app.py                      # Main Flask backend application (camera, video)
├── esp32_platform_code/        # Directory for ESP32 platform firmware
│   └── esp32_platform_code.ino # Example ESP32 WebSocket server & motor control
├── static/
│   └── js/
│       ├── PlatformController.js # JS class for managing platform WebSocket connection & state
│       └── main.js             # Frontend JavaScript logic for UI, camera, and platform
└── templates/
    └── index.html              # Main HTML page for the HUD web interface
└── README.md                   # This file
```

## Setup and Installation

### Prerequisites

* Python 3.7+
* pip (Python package installer)
* An ONVIF-compliant IP camera with RTSP streaming enabled.
* An ESP32 (or similar microcontroller) programmed with the WebSocket server firmware (see `esp32_platform_code.ino` or your own implementation).
* Platform hardware (motors, drivers) connected to the ESP32.

### Installation Steps

1.  **Clone the repository (or download the files):**
    Navigate to the project's root directory.

2.  **Setup Python Backend (Flask Server for Camera/Video):**
    * Create a virtual environment (recommended):
        ```bash
        python -m venv venv
        # On Windows: venv\Scripts\activate
        # On macOS/Linux: source venv/bin/activate
        ```
    * Install Python dependencies:
        Create a `requirements.txt` file in the project root with:
        ```txt
        Flask
        opencv-python
        requests
        flask-cors
        ```
        Then run:
        ```bash
        pip install -r requirements.txt
        ```

3.  **Setup ESP32 Platform:**
    * Open `esp32_platform_code/esp32_platform_code.ino` (or your platform code) in the Arduino IDE or PlatformIO.
    * Install necessary libraries (e.g., `ESPAsyncWebServer`, `AsyncTCP`, `ESP32Servo`, `ArduinoJson`).
    * Configure WiFi credentials (`ssid`, `password`) within the `.ino` file.
    * Upload the firmware to your ESP32. Note the IP address the ESP32 gets after connecting to WiFi (it will be printed to the Serial Monitor).

## Configuration

1.  **Network:** Ensure your computer running the backend server, the IP camera, and the ESP32 platform are on the same network.
2.  **Backend (`app.py` - Optional Default):**
    * You can change the `DEFAULT_RTSP_URL` in `app.py` if needed.
3.  **Web Interface Configuration (via HUD Settings Panel):**
    * Once the application is running, click the "Настройки" (Settings) button on the web interface.
    * **Camera Settings:**
        * **IP Камеры (ONVIF Host):** IP address of your camera.
        * **RTSP URL (для видеопотока):** Full RTSP URL of your camera's video stream.
        * **ONVIF Пользователь & Пароль:** Credentials for ONVIF authentication.
        * **Тип Камеры:** Select the camera type.
        * **Инвертировать Tilt:** Check if your camera's tilt is inverted.
    * **Platform Settings:**
        * **IP Платформы (ESP32 WebSocket):** The IP address of your ESP32 platform.

## Running the Application

1.  **Start the ESP32 Platform:** Ensure your ESP32 is powered on and connected to WiFi.
2.  **Start the Flask Backend Server:**
    Navigate to the project root directory in your terminal (activate venv) and run:
    ```bash
    python app.py
    ```
    The server typically starts on `http://0.0.0.0:5000/`.

3.  **Access the Web Interface:**
    Open your web browser and go to: `http://localhost:5000/`
    (Or `http://<your_server_ip>:5000/` if accessing from another device).

## Usage

1.  **Open Settings Panel:** Click the settings icon.
2.  **Configure Camera & Platform:** Enter details for your camera and the ESP32's IP address. Close the settings panel.
3.  **Start Video Stream:** Click the video start/update button (if not starting automatically or if URL changed). The video should appear as the background.
4.  **Control Camera PTZ:** Use the on-screen PTZ controls or keyboard shortcuts (Arrow keys, Z, X).
5.  **Control Platform:**
    * The system will attempt to connect to the ESP32 WebSocket server based on the IP provided. Connection status is shown on the HUD.
    * Use W, A, S, D keys for movement.
    * Use Spacebar to toggle the handbrake.
    * Throttle and steering levels are displayed on the HUD.
6.  **View Logs:** Check the "Системный Лог" panel for status messages and errors. Also, check the console of your Flask server and the ESP32 Serial Monitor.

## Important Notes & Limitations

* **ONVIF Compatibility:** Camera firmware variations might exist.
* **MJPEG Streaming:** The video is streamed as MJPEG, which is compatible but can have higher latency/bandwidth use.
* **WebSocket (Platform):** Platform control responsiveness depends on network stability between the browser and the ESP32.
* **Network:** Overall performance depends on your local network.
* **Security:**
    * ONVIF credentials are sent to the backend. Secure the browser-backend connection if needed.
    * The Flask server and ESP32 WebSocket server are not protected by authentication by default.
* **Coordinate Systems:** Ensure the `PlatformController.js` and ESP32 firmware agree on motor command interpretation (e.g., positive/negative values for forward/reverse/left/right).

## Troubleshooting

* **PTZ/Video Issues:**
    * Verify Flask server is running and no errors in its console.
    * Verify camera IP, RTSP URL, and ONVIF credentials.
    * Test RTSP URL with VLC.
    * Check network connectivity and firewalls.
* **Platform Control Issues:**
    * Verify ESP32 is powered, connected to WiFi, and its WebSocket server is running (check ESP32 Serial Monitor for IP and status).
    * Ensure the Platform IP in the web UI settings is correct.
    * Check the browser console for WebSocket connection errors or messages from `PlatformController.js`.
    * Verify CORS is correctly set on the ESP32 if facing connection issues from a different origin than the ESP32 itself (the provided ESP code includes `Access-Control-Allow-Origin`, `*`).
* **JavaScript errors in browser console:**
    * Ensure all DOM elements referenced in `main.js` have matching IDs in `index.html`.

## Future Enhancements (TODO)

* [ ] More robust error handling and user feedback across all components.
* [ ] Option to save and load multiple camera/platform configurations.
* [ ] Consider WebRTC for lower-latency video streaming.
* [ ] Add authentication/authorization for accessing the web interface.
* [ ] Allow configuration of PTZ and platform movement speeds/sensitivities from UI.
* [ ] Display more telemetry from the platform (e.g., battery, sensor data) if available.
* [ ] Visual joystick controls on the UI for platform and/or camera.

## License

This project is open-source. Feel free to use, modify, and distribute. Consider adding a specific license like MIT or Apache 2.0.
