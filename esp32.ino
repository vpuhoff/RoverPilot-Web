#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ESP32Servo.h>

// ... (все ваши предыдущие определения SSID, пароля, пинов, калибровок серво остаются здесь) ...
const char* ssid = "DarkNet 2G";
const char* password = "Integral320";

Servo teaserServoLeft;
Servo teaserServoRight;
int servoLeftPin = 6;
int servoRightPin = 7;

const int SERVO_PULSE_NEUTRAL = 1500;
const int SERVO_PULSE_MAX_SPEED_CW = 1900;
const int SERVO_PULSE_MAX_SPEED_CCW = 1100;
const int SERVO_MIN_PULSE_OFFSET_FROM_NEUTRAL = 25;
const int ATTACH_PWM_MIN_US = 1000;
const int ATTACH_PWM_MAX_US = 2000;

AsyncWebServer server(80);
String lastCommand = "None";
int currentLeftSpeed = 0;  // Это будут фактические значения, отправленные в setPlatformSpeed
int currentRightSpeed = 0; // Это будут фактические значения, отправленные в setPlatformSpeed

// HTML-код страницы (мы его сильно изменим на следующем шаге для JS)
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE HTML><html>
<head>
  <title>ESP32 Advanced Control</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 10px; background-color: #f0f0f0; display: flex; flex-direction: column; align-items: center; user-select: none; }
    .container { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); text-align: center; width: 90%; max-width: 450px; }
    h1 { color: #333; margin-top: 0;}
    .instructions { margin-bottom: 15px; font-size: 0.9em; color: #555; }
    .status-box { border: 1px solid #ddd; padding: 10px; margin-top: 20px; border-radius: 5px; background-color: #e9e9e9; font-size: 0.9em;}
    .status-box p { margin: 5px 0; }
    .bar-container { width: 100%; background-color: #ddd; border-radius: 5px; margin-bottom: 10px; height: 20px; position: relative; }
    .bar { height: 100%; background-color: #4CAF50; border-radius: 5px; text-align: center; line-height: 20px; color: white; font-size:0.8em; position: absolute; left: 50%; transform: translateX(-50%);}
    .bar.steering { background-color: #2196F3; }
    .bar.zero-marker { background-color: #888; width: 2px; height: 100%; position: absolute; left: 50%; top:0; transform: translateX(-50%);}
    #throttleBarText, #steeringBarText { position: relative; z-index:1; }
    .controls-display { margin-top:10px; font-size: 0.8em; }
    #notification { margin-top: 15px; padding: 10px; border-radius: 5px; display: none; color: white; }
    .success { background-color: #28a745; }
    .error { background-color: #dc3545; }
    .button-controls { margin-top: 20px; display: flex; justify-content: center; gap: 10px; }
    .button-controls button { padding: 10px 15px; font-size: 1em; cursor: pointer; border-radius: 5px; border: none; background-color: #6c757d; color:white;}
    .button-controls button:active {transform: scale(0.95);}
  </style>
</head>
<body>
  <div class="container">
    <h1>Advanced Platform Control</h1>
    <div class="instructions">
      Use W (gas), S (brake/reverse), A (steer left), D (steer right). Q for handbrake.
    </div>

    <div>Throttle:</div>
    <div class="bar-container">
      <div class="bar zero-marker"></div>
      <div class="bar" id="throttleBar" style="width: 0%; left: 50%;"><span id="throttleBarText">0%</span></div>
    </div>

    <div>Steering:</div>
    <div class="bar-container">
      <div class="bar zero-marker"></div>
      <div class="bar steering" id="steeringBar" style="width: 0%; left: 50%;"><span id="steeringBarText">0</span></div>
    </div>
    
    <div class="controls-display">
      Keys: <span id="keysDisplay"></span>
    </div>

    <div class="button-controls">
        <button id="btnHandbrake">Handbrake (Q)</button>
    </div>
    
    <div id="notification"></div>

    <div class="status-box">
      <p>ESP32 Status: Connected</p>
      <p>Last Sent: L: <span id="sentLeft">0</span>% | R: <span id="sentRight">0</span>%</p>
      <p>Raw Throttle: <span id="rawThrottle">0</span> | Raw Steering: <span id="rawSteering">0</span></p>
    </div>
  </div>
  <script>
    const MAX_THROTTLE = 100;
    const MAX_STEERING = 100; // Steering will be mapped from -100 to 100

    const THROTTLE_ACCELERATION = 5; // Increase per update if W pressed
    const THROTTLE_DECELERATION_NATURAL = 2; // Decrease per update if W/S not pressed
    const BRAKE_POWER = 6; // Decrease per update if S pressed (also for reverse)
    
    const STEERING_SPEED = 9; // Change per update if A/D pressed
    const STEERING_RETURN_SPEED = 7; // Return to center per update

    const UPDATE_INTERVAL = 50; // ms (20 updates per second)

    let throttle = 0;
    let steering = 0;
    let handbrakeOn = false;

    const keysPressed = {};

    // UI Elements
    const throttleBar = document.getElementById('throttleBar');
    const throttleBarText = document.getElementById('throttleBarText');
    const steeringBar = document.getElementById('steeringBar');
    const steeringBarText = document.getElementById('steeringBarText');
    const sentLeftEl = document.getElementById('sentLeft');
    const sentRightEl = document.getElementById('sentRight');
    const rawThrottleEl = document.getElementById('rawThrottle');
    const rawSteeringEl = document.getElementById('rawSteering');
    const keysDisplayEl = document.getElementById('keysDisplay');
    const notificationDiv = document.getElementById('notification');
    const btnHandbrake = document.getElementById('btnHandbrake');

    document.addEventListener('keydown', (event) => {
      keysPressed[event.key.toLowerCase()] = true;
      updateKeysDisplay();
      if (event.key.toLowerCase() === 'q') {
        toggleHandbrake();
        event.preventDefault(); // Prevent default browser action for Q
      }
      // Prevent default for arrow keys and space if they might scroll
      if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(event.key.toLowerCase())) {
        event.preventDefault();
      }
    });

    document.addEventListener('keyup', (event) => {
      delete keysPressed[event.key.toLowerCase()];
      updateKeysDisplay();
    });
    
    btnHandbrake.addEventListener('click', toggleHandbrake);
    btnHandbrake.addEventListener('touchstart', (e) => {e.preventDefault(); toggleHandbrake();}, {passive: false});


    function toggleHandbrake() {
        handbrakeOn = !handbrakeOn; // Toggle state
        if (handbrakeOn) {
            throttle = 0; // Immediately stop throttle
            // Optionally, could also center steering or apply brake effect via motor commands
            btnHandbrake.style.backgroundColor = '#dc3545'; // Red when on
            btnHandbrake.textContent = "Handbrake ON (Q)";
        } else {
            btnHandbrake.style.backgroundColor = '#6c757d'; // Default grey
            btnHandbrake.textContent = "Handbrake (Q)";
        }
    }


    function updateControlLogic() {
      // --- Steering ---
      if (keysPressed['a'] || keysPressed['arrowleft']) {
        steering -= STEERING_SPEED;
      } else if (keysPressed['d'] || keysPressed['arrowright']) {
        steering += STEERING_SPEED;
      } else { // Return to center
        if (steering > STEERING_RETURN_SPEED) steering -= STEERING_RETURN_SPEED;
        else if (steering < -STEERING_RETURN_SPEED) steering += STEERING_RETURN_SPEED;
        else steering = 0;
      }
      steering = Math.max(-MAX_STEERING, Math.min(MAX_STEERING, steering));

      // --- Throttle & Handbrake ---
      if (handbrakeOn) {
        throttle = 0; 
        // If Q is held, it will keep throttle at 0. If Q is a toggle, this frame's throttle is 0.
      } else {
        if (keysPressed['w'] || keysPressed['arrowup']) {
          throttle += THROTTLE_ACCELERATION;
        } else if (keysPressed['s'] || keysPressed['arrowdown']) {
          throttle -= BRAKE_POWER;
        } else { // Natural deceleration
          if (throttle > THROTTLE_DECELERATION_NATURAL) throttle -= THROTTLE_DECELERATION_NATURAL;
          else if (throttle < -THROTTLE_DECELERATION_NATURAL) throttle += THROTTLE_DECELERATION_NATURAL;
          else throttle = 0;
        }
      }
      throttle = Math.max(-MAX_THROTTLE, Math.min(MAX_THROTTLE, throttle));
      
      // If Q was just pressed to turn handbrake on, ensure throttle is 0 for this send cycle
      if (keysPressed['q'] && !handbrakeOn) { // Logic if Q is momentary, not toggle
          // This part is tricky if Q is a toggle. The toggleHandbrake function handles it.
      }


      // --- Mixing: Throttle & Steering to Motor Speeds ---
      let baseSpeed = throttle;
      let steeringAdjustment = steering;

      // More arcade-like steering: reduce steering effect at very low throttle, full effect otherwise
      // Or even scale steering by throttle: steeringAdjustment = steering * (Math.abs(throttle)/MAX_THROTTLE);
      // For now, simple addition/subtraction:
      
      let conceptualLeftSpeed = baseSpeed + steeringAdjustment;
      let conceptualRightSpeed = baseSpeed - steeringAdjustment;

      // Normalize/Clamp motor speeds if they exceed MAX_THROTTLE due to steering
      // This can be sophisticated (e.g. scale both down if one exceeds)
      // Simple clamping:
      conceptualLeftSpeed = Math.max(-MAX_THROTTLE, Math.min(MAX_THROTTLE, conceptualLeftSpeed));
      conceptualRightSpeed = Math.max(-MAX_THROTTLE, Math.min(MAX_THROTTLE, conceptualRightSpeed));
      
      // --- Send to ESP32 ---
      // We round to integers as ESP32 expects int
      sendDriveCommand(Math.round(conceptualLeftSpeed), Math.round(conceptualRightSpeed));

      // --- Update UI ---
      updateUI(Math.round(conceptualLeftSpeed), Math.round(conceptualRightSpeed));
    }

    function sendDriveCommand(left, right) {
      fetch(`/drive?left=${left}&right=${right}`)
        .then(response => {
          if (!response.ok) { 
            // If server sends an error status, try to parse JSON for more info
            return response.json().then(errData => {throw new Error(errData.message || 'Network response was not ok');});
          }
          return response.json();
        })
        .then(data => {
          if (data.status === 'success') {
            // Optionally show success notification or use data from response
            // showNotification(`Sent: L ${data.actual_motor_L}, R ${data.actual_motor_R}`, 'success');
            sentLeftEl.textContent = data.actual_motor_L; // Display actual values sent to motor
            sentRightEl.textContent = data.actual_motor_R;
          } else {
            showNotification(data.message || 'Command failed', 'error');
          }
        })
        .catch(error => {
          console.error('Error sending drive command:', error);
          showNotification(`Error: ${error.message}`, 'error');
          sentLeftEl.textContent = "Err";
          sentRightEl.textContent = "Err";
        });
    }

    function updateUI(finalLeft, finalRight) {
      // Throttle bar
      let throttlePercent = (throttle / MAX_THROTTLE) * 50; // Max 50% width for positive or negative
      throttleBar.style.width = Math.abs(throttlePercent * 2) + '%';
      if (throttle >= 0) {
        throttleBar.style.left = '50%';
        throttleBar.style.transform = 'translateX(0%)';
        throttleBar.style.backgroundColor = '#4CAF50'; // Green for forward
      } else {
        throttleBar.style.left = (50 - Math.abs(throttlePercent * 2)) + '%';
        throttleBar.style.transform = 'translateX(0%)';
        throttleBar.style.backgroundColor = '#f44336'; // Red for reverse
      }
      throttleBarText.textContent = `${Math.round(throttle)}%`;

      // Steering bar
      let steeringPercent = (steering / MAX_STEERING) * 50; // Max 50% width for left or right
      steeringBar.style.width = Math.abs(steeringPercent * 2) + '%';
       if (steering >= 0) { // Right
        steeringBar.style.left = '50%';
        steeringBar.style.transform = 'translateX(0%)';
      } else { // Left
        steeringBar.style.left = (50 - Math.abs(steeringPercent * 2)) + '%';
        steeringBar.style.transform = 'translateX(0%)';
      }
      steeringBarText.textContent = `${Math.round(steering)}`;
      
      rawThrottleEl.textContent = Math.round(throttle);
      rawSteeringEl.textContent = Math.round(steering);
    }
    
    function updateKeysDisplay() {
        keysDisplayEl.textContent = Object.keys(keysPressed).join(', ') || 'None';
    }

    function showNotification(message, type) {
        notificationDiv.textContent = message;
        notificationDiv.className = type;
        notificationDiv.style.display = 'block';
        clearTimeout(notificationDiv.timer);
        notificationDiv.timer = setTimeout(() => {
            notificationDiv.style.display = 'none';
        }, 2500);
    }

    // Start the control loop
    setInterval(updateControlLogic, UPDATE_INTERVAL);
    updateKeysDisplay(); // Initial display
  </script>
</body></html>
)rawliteral";


// Вспомогательные функции для серво (calculatePulseWidth, setPlatformSpeed) остаются ТЕМИ ЖЕ, что и раньше
long calculatePulseWidth(int speedPercent) {
  speedPercent = constrain(speedPercent, -100, 100);
  long pulseWidth;
  if (speedPercent == 0) {
    pulseWidth = SERVO_PULSE_NEUTRAL;
  } else if (speedPercent > 0) {
    pulseWidth = map(speedPercent, 1, 100,
                     SERVO_PULSE_NEUTRAL + SERVO_MIN_PULSE_OFFSET_FROM_NEUTRAL,
                     SERVO_PULSE_MAX_SPEED_CW);
  } else {
    pulseWidth = map(speedPercent, -100, -1,
                     SERVO_PULSE_MAX_SPEED_CCW,
                     SERVO_PULSE_NEUTRAL - SERVO_MIN_PULSE_OFFSET_FROM_NEUTRAL);
  }
  return pulseWidth;
}

void setPlatformSpeed(int leftSpeedPercent, int rightSpeedPercent) {
  // Эта функция уже откалибрована и просто устанавливает скорости как есть
  long leftPulse = calculatePulseWidth(leftSpeedPercent);
  long rightPulse = calculatePulseWidth(rightSpeedPercent);
  teaserServoLeft.writeMicroseconds(leftPulse);
  teaserServoRight.writeMicroseconds(rightPulse);
  // Serial вывод можно оставить для отладки или убрать
  // Serial.print("Set Left: "); Serial.print(leftSpeedPercent); Serial.print("% -> "); Serial.print(leftPulse); Serial.print("us");
  // Serial.print(" | Set Right: "); Serial.print(rightSpeedPercent); Serial.print("% -> "); Serial.print(rightPulse); Serial.println("us");
}

// Модифицированный обработчик команд или новый для /drive
void processDriveCommand(AsyncWebServerRequest *request, int conceptualLeft, int conceptualRight) {
  // Применяем калибровку направления (инверсия правого мотора)
  int actualLeftForMotor = conceptualLeft;
  int actualRightForMotor = -conceptualRight; // Правый мотор инвертирован

  // Ограничиваем значения перед отправкой в setPlatformSpeed (на всякий случай)
  actualLeftForMotor = constrain(actualLeftForMotor, -100, 100);
  actualRightForMotor = constrain(actualRightForMotor, -100, 100);

  setPlatformSpeed(actualLeftForMotor, actualRightForMotor);

  currentLeftSpeed = actualLeftForMotor;   // Сохраняем фактические значения для отображения
  currentRightSpeed = actualRightForMotor;
  lastCommand = "Drive (L:" + String(conceptualLeft) + " R:" + String(conceptualRight) + 
                " -> M_L:" + String(actualLeftForMotor) + " M_R:" + String(actualRightForMotor) + ")";
  
  String jsonResponse = "{\"status\":\"success\", \"sent_conceptual_L\":" + String(conceptualLeft) +
                        ", \"sent_conceptual_R\":" + String(conceptualRight) +
                        ", \"actual_motor_L\":" + String(actualLeftForMotor) +
                        ", \"actual_motor_R\":" + String(actualRightForMotor) + "}";
  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", jsonResponse);
  response->addHeader("Access-Control-Allow-Origin", "*"); 
  request->send(response);
  Serial.println(lastCommand);
}


void setup() {
  Serial.begin(115200);
  delay(1000);

  ESP32PWM::allocateTimer(0);
  teaserServoLeft.setPeriodHertz(50);
  teaserServoLeft.attach(servoLeftPin, ATTACH_PWM_MIN_US, ATTACH_PWM_MAX_US);
  teaserServoRight.setPeriodHertz(50);
  teaserServoRight.attach(servoRightPin, ATTACH_PWM_MIN_US, ATTACH_PWM_MAX_US);

  Serial.println("--- Initializing Mobile Platform (Advanced Control) ---");
  setPlatformSpeed(0, 0);
  delay(500);
  Serial.println("Platform servos initialized.");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send_P(200, "text/html", index_html);
  });

  // Новый эндпоинт для приема команд управления
  server.on("/drive", HTTP_GET, [](AsyncWebServerRequest *request){
    if (request->hasParam("left") && request->hasParam("right")) {
      int conceptualL = request->getParam("left")->value().toInt();
      int conceptualR = request->getParam("right")->value().toInt();
      processDriveCommand(request, conceptualL, conceptualR);
    } else {
      request->send(400, "application/json", "{\"status\":\"error\", \"message\":\"Missing left/right parameters\"}");
    }
  });
  
  // Старый эндпоинт /status можно оставить или модифицировать для новой информации
  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *request){
    String jsonResponse = "{\"last_command_full\":\"" + lastCommand + 
                          "\", \"motor_L\":" + String(currentLeftSpeed) + 
                          ", \"motor_R\":" + String(currentRightSpeed) + "}";
    AsyncWebServerResponse *response = request->beginResponse(200, "application/json", jsonResponse);
    response->addHeader("Access-Control-Allow-Origin", "*"); 
    request->send(response);
  });

  server.begin();
  Serial.println("HTTP server started");
}

void loop() {
  // Пусто, так как ESPAsyncWebServer работает асинхронно
  delay(10);
}