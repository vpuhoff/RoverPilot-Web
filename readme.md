# Web-Based ONVIF PTZ Camera Control and RTSP Stream Viewer

This project provides a web interface to control Pan-Tilt-Zoom (PTZ) functions of ONVIF-compliant IP cameras and view their RTSP video stream. It consists of a Python Flask backend that handles communication with the camera and transcodes the video stream, and an HTML/JavaScript frontend for user interaction.

## Features

* **Web-based Interface:** Control your camera from any modern web browser.
* **PTZ Control:** Pan, Tilt, Zoom In, Zoom Out, and Stop commands.
* **Keyboard Shortcuts:** Control PTZ functions using keyboard keys (W, A, S, D, Z, X, Space).
* **RTSP to MJPEG Streaming:** View the camera's RTSP video stream directly in the browser (transcoded to MJPEG by the backend).
* **ONVIF Communication:**
    * Sends ONVIF SOAP requests for PTZ control.
    * Supports WS-Security UsernameToken Profile for authentication.
* **Multi-Camera Type Support:** Pre-configured settings for specific camera types (e.g., YOOSEE, YCC365, Y05), extensible for others.
* **Configurable Camera Settings:** Set camera IP, RTSP URL, ONVIF credentials, and camera type through the UI.
* **CORS Handled:** Backend uses `Flask-CORS` to allow requests from the frontend.
* **Visual Feedback:** UI includes a loader animation during requests and a logging area.

## Tech Stack

* **Backend:**
    * Python 3
    * Flask (web framework)
    * OpenCV (`opencv-python`) (for RTSP stream capture and MJPEG encoding)
    * Requests (for sending ONVIF HTTP requests)
    * Flask-CORS (for handling Cross-Origin Resource Sharing)
* **Frontend:**
    * HTML5
    * JavaScript (ES6+)
    * Tailwind CSS (for styling, via CDN)

## Project Structure

```
BOT-CONTROL-SERVER/
├── app.py                # Main Flask backend application
├── static/
│   └── js/
│       └── main.js       # Frontend JavaScript logic
└── templates/
    └── index.html        # Main HTML page for the web interface
└── README.md             # This file
```

## Setup and Installation

### Prerequisites

* Python 3.7+
* pip (Python package installer)
* An ONVIF-compliant IP camera with RTSP streaming enabled.

### Installation Steps

1.  **Clone the repository (or download the files):**
    ```bash
    # If you have it in a git repository:
    # git clone <repository-url>
    # cd BOT-CONTROL-SERVER
    ```
    If you downloaded the files, navigate to the `BOT-CONTROL-SERVER` directory.

2.  **Create a virtual environment (recommended):**
    ```bash
    python -m venv venv
    # On Windows
    venv\Scripts\activate
    # On macOS/Linux
    source venv/bin/activate
    ```

3.  **Install Python dependencies:**
    Create a `requirements.txt` file in the `BOT-CONTROL-SERVER` directory with the following content:
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

## Configuration

1.  **Camera Network:** Ensure your computer running the backend server and the IP camera are on the same network and can reach each other.
2.  **Backend Configuration (Optional Default):**
    * In `app.py`, you can change the `DEFAULT_RTSP_URL` if needed:
        ```python
        DEFAULT_RTSP_URL = "rtsp://your_user:your_password@your_camera_ip:554/your_stream_path"
        ```
3.  **Web Interface Configuration:**
    * Once the application is running (see next section), open the web interface.
    * Fill in the following fields:
        * **IP Камеры (ONVIF Host):** The IP address of your camera (e.g., `192.168.1.100`).
        * **RTSP URL (для видеопотока):** The full RTSP URL of your camera's video stream.
        * **ONVIF Пользователь:** Username for ONVIF authentication.
        * **ONVIF Пароль:** Password for ONVIF authentication.
        * **Тип Камеры:** Select the camera type that matches your device (e.g., YCC365, YOOSEE, Y05). This determines which ONVIF service paths and profiles are used.
        * **Инвертировать Вверх/Вниз:** Check if your camera's tilt controls are inverted.

## Running the Application

1.  **Start the Flask backend server:**
    Navigate to the `BOT-CONTROL-SERVER` directory in your terminal (and activate the virtual environment if you created one) and run:
    ```bash
    python app.py
    ```
    The server will typically start on `http://0.0.0.0:5000/`.

2.  **Access the Web Interface:**
    Open your web browser and go to:
    ```
    http://localhost:5000/
    ```
    (Or `http://<your_server_ip>:5000/` if accessing from another device on the network).

## Usage

1.  **Configure Camera Settings:** Enter your camera's details in the input fields on the web page. The configuration is updated automatically when you change a field.
2.  **Start Video Stream:** Click the "Запустить/Обновить видео" (Start/Update Video) button. The RTSP stream from your camera should appear in the video display area (transcoded to MJPEG).
3.  **Control PTZ:**
    * Use the arrow buttons (Up, Down, Left, Right) for panning and tilting.
    * Use the "Zoom +" and "Zoom -" buttons for zooming.
    * Use the "СТОП" (STOP) button to halt any ongoing PTZ movement.
    * Alternatively, use keyboard shortcuts:
        * `W`: Tilt Up
        * `S`: Tilt Down
        * `A`: Pan Left
        * `D`: Pan Right
        * `Z`: Zoom In
        * `X`: Zoom Out
        * `Spacebar`: Stop PTZ movement
4.  **View Logs:** Check the "Логи" (Logs) section at the bottom of the page for status messages and error information. Also, check the console of your Flask server for backend logs.

## Important Notes & Limitations

* **ONVIF Compatibility:** While the project aims to support standard ONVIF commands, different camera firmwares might have slight variations. The pre-configured camera types (YOOSEE, YCC365, Y05) use specific known ONVIF paths. If your camera is not one of these types, you might need to adjust the `CAMERA_PARAMS_CONFIG` in `main.js` (if frontend constructs SOAP) or `CAMERA_PARAMS` in `app.py` (if backend constructs SOAP - current implementation) to match your camera's ONVIF PTZ service path and profile token.
* **MJPEG Streaming:** The video is streamed as MJPEG. This format is widely compatible but can have higher latency and bandwidth usage compared to HLS or WebRTC.
* **Network:** The performance of video streaming and PTZ control depends on your network stability and bandwidth.
* **Security:**
    * ONVIF credentials are sent from the browser to the backend. Ensure the connection between your browser and the backend server is secure if used in a sensitive environment (e.g., by running Flask over HTTPS, which is not configured by default).
    * The backend server itself is not protected by any authentication by default. Anyone who can access the server's URL can control the camera.
* **Error Handling:** Basic error handling is in place, but it can be further improved for robustness.

## Troubleshooting

* **"Failed to fetch" error in browser console / PTZ commands not working:**
    * This is often a CORS (Cross-Origin Resource Sharing) issue if the backend is not configured correctly. The current `app.py` uses `Flask-CORS` which should handle this for requests to `localhost:5000`.
    * Ensure the Flask backend server (`app.py`) is running.
    * Check the Flask server console for any errors.
    * Verify the camera IP address and ONVIF credentials are correct.
* **Video not showing:**
    * Verify the RTSP URL is correct and accessible (e.g., test it with VLC media player).
    * Check the Flask server console for errors from OpenCV related to RTSP stream connection.
    * Ensure the camera is powered on and connected to the network.
    * Firewall or network issues might be blocking the RTSP stream to the server or the MJPEG stream to the browser.
* **JavaScript errors in browser console:**
    * Ensure all DOM elements referenced in `main.js` (like `logOutput`, `loader`, `videoStream`) have matching IDs in `index.html`.

## Future Enhancements (TODO)

* [ ] More robust error handling and user feedback.
* [ ] Support for discovering ONVIF cameras on the network.
* [ ] Option to save and load camera configurations.
* [ ] Implement WebRTC for lower-latency video streaming.
* [ ] Add authentication/authorization for accessing the web interface.
* [ ] Allow configuration of PTZ speed.
* [ ] Create a configuration file for backend settings instead of hardcoding defaults.

## License

This project is open-source. Feel free to use, modify, and distribute. If no specific license is chosen, consider adding one like MIT or Apache 2.0.