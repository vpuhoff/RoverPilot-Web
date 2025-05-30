All right, you're looking for the fully updated README.md that reflects the project's current state, especially after integrating WebRTC for video streaming.

Here's the complete, non-abbreviated version based on our discussions:

# Web-Based Control Interface for PTZ Camera and Robotic Platform with WebRTC Video

This project provides a web interface to:
1.  Control Pan-Tilt-Zoom (PTZ) functions of ONVIF-compliant IP cameras.
2.  View the camera's RTSP video stream using **WebRTC** for low-latency streaming.
3.  Control a robotic platform (e.g., ESP32-based) via WebSocket communication.

It consists of a Python Flask backend (for camera ONVIF interaction, WebRTC signaling, and acting as a WebRTC media gateway for the RTSP stream) and an HTML/JavaScript/CSS frontend (for the user interface and direct platform control). The interface is styled to resemble a Heads-Up Display (HUD) or drone control panel.

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
* **Low-Latency Video Streaming (WebRTC):** View the camera's RTSP video stream directly in the browser with significantly reduced latency compared to MJPEG. The Flask backend acts as a gateway, converting RTSP to a WebRTC compatible stream.
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

* **Backend (Camera, Video & WebRTC Signaling):**
    * Python 3
    * Flask (web framework, can be run with an ASGI server for async WebRTC parts)
    * **`aiortc`** (for WebRTC server-side implementation in Python)
    * OpenCV (`opencv-python`) (can be used by `aiortc.MediaPlayer` or as a fallback for RTSP handling)
    * Requests (for sending ONVIF HTTP requests)
    * Flask-CORS (for handling Cross-Origin Resource Sharing)
    * Asyncio (for `aiortc`)
* **Frontend:**
    * HTML5
    * JavaScript (ES6+) with WebRTC API
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
├── app.py                      # Main Flask backend application (camera, video, WebRTC)
├── esp32_platform_code/        # Directory for ESP32 platform firmware
│   └── esp32_platform_code.ino # Example ESP32 WebSocket server & motor control
├── static/
│   └── js/
│       ├── PlatformController.js # JS class for managing platform WebSocket connection & state
│       └── main.js             # Frontend JavaScript logic for UI, camera, platform, and WebRTC client
└── templates/
    └── index.html              # Main HTML page for the HUD web interface
└── README.md                   # This file
```

## Setup and Installation

### Prerequisites

* Python 3.7+
* pip (Python package installer)
* An ONVIF-compliant IP camera with RTSP streaming enabled.
* An ESP32 (or similar microcontroller) programmed with the WebSocket server firmware.
* Platform hardware (motors, drivers) connected to the ESP32.
* FFmpeg installed and in PATH (often required by `aiortc.MediaPlayer` for handling various RTSP stream formats and codecs).

### Installation Steps

1.  **Clone the repository (or download the files):**
    Navigate to the project's root directory.

2.  **Setup Python Backend:**
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
        flask-cors
        opencv-python
        requests
        aiortc
        # Optional, for running Flask with asyncio more robustly with WebRTC:
        # uvicorn
        # acompaña 
        # python-dotenv (if you use .env files for configuration)
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

1.  **Network:** Ensure your computer running the backend server, the IP camera, and the ESP32 platform are on the same local network and can reach each other.
2.  **Backend (`app.py`):**
    * Set the `DEFAULT_RTSP_URL` in `app.py` to your camera's stream. This will be used if the client doesn't specify one (though current client implementation relies on this server default).
3.  **Web Interface Configuration (via HUD Settings Panel):**
    * Once the application is running, click the "Настройки" (Settings) icon on the web interface.
    * **Camera Settings:**
        * **IP Камеры (ONVIF Host):** IP address of your camera for PTZ control.
        * **RTSP URL (для видеопотока):** Full RTSP URL of your camera's video stream (this is primarily for reference or if you switch back to MJPEG; WebRTC uses the server-configured `DEFAULT_RTSP_URL` unless `app.py` is modified to accept it dynamically).
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
    *Note: The `app.py` provided uses a threaded asyncio loop for `aiortc` to run with Flask's development server. For production or more stable async handling, an ASGI server (like Uvicorn with an adapter such as `acompaña`, or by migrating to an ASGI framework like Quart/FastAPI) is recommended.*

3.  **Access the Web Interface:**
    Open your web browser and go to: `http://localhost:5000/`
    (Or `http://<your_server_ip>:5000/` if accessing from another device on the same network).

## Usage

1.  **Open Settings Panel:** Click the settings icon on the top bar.
2.  **Configure Camera & Platform:** Enter details for your camera (for PTZ) and the ESP32's IP address (for platform control). The RTSP URL in the settings is for reference or if you decide to implement dynamic RTSP source selection for WebRTC on the server. Close the settings panel.
3.  **Start Video Stream:** Click the video start/update button (camera icon in the top bar). The system will attempt to establish a WebRTC connection to the Flask server, which in turn streams video from the `DEFAULT_RTSP_URL` configured in `app.py`. The video should appear as the background with low latency.
4.  **Control Camera PTZ:** Use the on-screen PTZ controls in the left panel or keyboard shortcuts (Arrow keys, Z, X).
5.  **Control Platform:**
    * The system will attempt to connect to the ESP32 WebSocket server based on the IP provided in settings. Connection status is shown on the HUD.
    * Use W, A, S, D keys for movement.
    * Use Spacebar to toggle the handbrake.
    * Throttle and steering levels are displayed on the HUD.
6.  **View Logs:** Check the "Системный Лог" panel for status messages from the frontend and errors. Also, check the console output of your Flask server (`app.py`) and the ESP32 Serial Monitor for more detailed backend and platform logs.

## Important Notes & Limitations

* **WebRTC Complexity & Signaling:** WebRTC introduces significant complexity compared to MJPEG, especially regarding the signaling process (SDP offer/answer, ICE candidate exchange) and NAT traversal. **The current implementation for ICE candidate exchange in the provided `main.js` and `app.py` is a placeholder/logging only.** A robust signaling mechanism (typically using WebSockets) MUST be fully implemented for WebRTC to function reliably across different networks.
* **RTSP to WebRTC Gateway:** The Flask server acts as a media gateway. Its performance (CPU usage) can be a factor, especially if the RTSP stream's codec (e.g., H.265) requires transcoding to a WebRTC-compatible format (e.g., H.264, VP8). `aiortc.MediaPlayer` often relies on FFmpeg for this.
* **STUN/TURN Servers:** For WebRTC connections beyond a simple local network (e.g., over the internet or through complex NATs), properly configured STUN servers (for discovering public IP addresses) and TURN servers (for relaying media when direct connection fails) are essential. The example JavaScript uses a public STUN server from Google.
* **ONVIF Compatibility:** While ONVIF is a standard, camera firmware implementations can vary, potentially affecting PTZ control.
* **Network Conditions:** Both WebRTC video streaming and WebSocket platform control are sensitive to network quality (latency, jitter, packet loss).
* **Security:**
    * ONVIF credentials are sent from the browser to the Flask backend. If deploying in a non-trusted environment, ensure this connection is over HTTPS.
    * The Flask server and ESP32 WebSocket server are not protected by any application-level authentication by default.
* **Coordinate Systems (Platform):** Ensure `PlatformController.js` and the ESP32 firmware agree on the interpretation of motor commands (e.g., positive/negative values for forward/reverse/left/right).

## Troubleshooting

* **General Issues:** Always check the browser's JavaScript console (F12), the Flask server's terminal output, and the ESP32's Serial Monitor for error messages.
* **PTZ Control Issues:**
    * Verify Flask server is running.
    * Correct camera IP, ONVIF credentials, and camera type in settings.
* **Platform Control Issues:**
    * Verify ESP32 is powered, on WiFi, and its WebSocket server is running (check ESP32 Serial Monitor for IP and status messages).
    * Correct Platform IP in UI settings.
    * Check browser console for WebSocket connection errors or messages from `PlatformController.js`.
* **WebRTC Video Not Showing / Connection Failing:**
    * **Server Logs (`app.py`):** Critical. Look for errors from `aiortc`, `MediaPlayer` (e.g., "Не удалось получить видео трек из RTSP плеера."), or during the `/offer` exchange. Check if `rtsp_video_track_source` is successfully initialized.
    * **Browser Console (`main.js`):**
        * Errors during `RTCPeerConnection` creation, `setLocalDescription`, `setRemoteDescription`.
        * Monitor `pc.iceConnectionState` and `pc.connectionState` logs. "failed" or "disconnected" states often point to ICE or DTLS handshake issues.
        * Ensure the SDP offer from the client is sent to `/offer` and a valid SDP answer is received and processed.
    * **ICE Candidate Exchange (Most Common Issue):** If this is not fully implemented (sending client candidates to server, server sending its candidates to client, and both sides calling `addIceCandidate`), the media connection will likely fail.
    * **STUN/TURN Configuration:** Verify `iceServers` in `main.js` (`RtcPeerConnectionConfig`). Test STUN/TURN server reachability if used.
    * **Firewall:** Firewalls (on the client, server, or network) can block WebRTC traffic (typically UDP ports, though TCP fallback via TURN is possible).
    * **Browser WebRTC Internals:** Use browser-specific diagnostic pages (e.g., `chrome://webrtc-internals` in Chrome, `about:webrtc` in Firefox) for detailed inspection of peer connections.
    * **RTSP Source:** Confirm the `DEFAULT_RTSP_URL` in `app.py` is correct and accessible by the Flask server (test with VLC on the server machine if possible).

## Future Enhancements (TODO)

* **[CRITICAL] Implement robust WebSocket signaling for ICE candidate exchange and other WebRTC messages (e.g., renegotiation).**
* [ ] More robust error handling and user feedback across all components.
* [ ] Option to save and load multiple camera/platform configurations.
* [ ] Allow dynamic selection/input of RTSP stream URL for WebRTC directly from the UI, to be used by the server.
* [ ] Add authentication/authorization for accessing the web interface and backend APIs.
* [ ] Allow configuration of PTZ and platform movement speeds/sensitivities from UI.
* [ ] Display more telemetry from the platform (e.g., battery, sensor data) if available and sent by ESP32.
* [ ] Visual joystick controls on the UI for platform and/or camera.
* [ ] Investigate using an ASGI server (Uvicorn, Hypercorn) with an adapter or migrating to an ASGI framework (Quart, FastAPI) for better handling of asyncio in the Python backend.

## License

This project is open-source. Feel free to use, modify, and distribute. 