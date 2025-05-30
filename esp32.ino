#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h> // <-- Используем ArduinoJson

// WiFi учетные данные
const char* ssid = "DarkNet 2G";
const char* password = "Integral320";

// Сервоприводы
Servo teaserServoLeft;
Servo teaserServoRight;
int servoLeftPin = 6;  // Внимание: проверьте пины 6 и 7 на вашей ESP32 плате,
int servoRightPin = 7; // они могут быть заняты SPI flash. Если есть проблемы, выберите другие.

// Калибровки серво (остаются без изменений)
const int SERVO_PULSE_NEUTRAL = 1500;
const int SERVO_PULSE_MAX_SPEED_CW = 1900;
const int SERVO_PULSE_MAX_SPEED_CCW = 1100;
const int SERVO_MIN_PULSE_OFFSET_FROM_NEUTRAL = 25;
const int ATTACH_PWM_MIN_US = 1000;
const int ATTACH_PWM_MAX_US = 2000;

// Веб-сервер и WebSocket сервер
AsyncWebServer server(80);
AsyncWebSocket ws("/ws"); // WebSocket сервер будет доступен по адресу /ws

// Глобальные переменные состояния
String lastCommand = "None";
int currentLeftSpeed = 0;
int currentRightSpeed = 0;

// HTML-код страницы (остается как есть, т.к. JS будет изменен отдельно)
const char index_html[] PROGMEM = R"rawliteral(
// ... (ваш существующий HTML код остается здесь без изменений) ...
// Изменения в title и wsConnectionStatus для ясности
<!DOCTYPE HTML><html>
<head>
 <title>ESP32 Advanced Control (WebSocket + ArduinoJson)</title>
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
   <h1>Advanced Platform Control (WebSocket + ArduinoJson)</h1>
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
     <p>ESP32 Status: <span id="wsConnectionStatus">Disconnected</span> (ArduinoJson)</p>
     <p>Last Sent: L: <span id="sentLeft">0</span>% | R: <span id="sentRight">0</span>%</p>
     <p>Raw Throttle: <span id="rawThrottle">0</span> | Raw Steering: <span id="rawSteering">0</span></p>
   </div>
 </div>
 <script>
 // Javascript будет изменен для использования WebSocket на следующем шаге.
 </script>
</body></html>
)rawliteral";

// Вспомогательные функции для серво (остаются без изменений)
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
  long leftPulse = calculatePulseWidth(leftSpeedPercent);
  long rightPulse = calculatePulseWidth(rightSpeedPercent);
  teaserServoLeft.writeMicroseconds(leftPulse);
  teaserServoRight.writeMicroseconds(rightPulse);
}

// Функция для отправки текущего статуса платформы клиенту WebSocket
void sendPlatformStatus(AsyncWebSocketClient *client) {
  if (!client || client->status() != WS_CONNECTED) {
    return;
  }

  StaticJsonDocument<256> doc; // Документ для исходящего JSON
  doc["type"] = "status_update";
  
  JsonObject data = doc.createNestedObject("data");
  data["motorL"] = currentLeftSpeed;
  data["motorR"] = currentRightSpeed;
  data["lastCommand"] = lastCommand;

  String output;
  serializeJson(doc, output);
  client->text(output);
}

// Отправка сообщения об ошибке клиенту WebSocket
void sendWsError(AsyncWebSocketClient *client, const String& message) {
  if (!client || client->status() != WS_CONNECTED) {
    return;
  }
  StaticJsonDocument<128> doc;
  doc["type"] = "error";
  doc["message"] = message;
  String output;
  serializeJson(doc, output);
  client->text(output);
}

// Обработчик событий WebSocket
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("WebSocket client #%u connected from %s\n", client->id(), client->remoteIP().toString().c_str());
      sendPlatformStatus(client); // Отправляем начальный статус при подключении
      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("WebSocket client #%u disconnected\n", client->id());
      break;
    case WS_EVT_DATA: {
      AwsFrameInfo *info = (AwsFrameInfo*)arg;
      if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
        // Данные пришли целиком и это текст
        char* msg_char = (char*)data;
        msg_char[len] = '\0'; // Убедимся, что строка нуль-терминирована
        
        Serial.printf("WS Data from client #%u: %s\n", client->id(), msg_char);

        StaticJsonDocument<128> doc; // Документ для входящих команд
        DeserializationError error = deserializeJson(doc, msg_char);

        if (error) {
          Serial.print(F("deserializeJson() failed: "));
          Serial.println(error.f_str());
          sendWsError(client, "Invalid JSON: " + String(error.c_str()));
          return;
        }

        String commandType = doc["command"].as<String>(); // Получаем тип команды

        if (commandType.equals("drive")) {
          if (doc.containsKey("payload") && doc["payload"].is<JsonObject>()) {
            JsonObject payload = doc["payload"];
            int conceptualL = payload["left"].as<int>();   // .as<int>() вернет 0 если ключ не найден или тип не тот
            int conceptualR = payload["right"].as<int>();

            int actualLeftForMotor = conceptualL;
            int actualRightForMotor = -conceptualR; // Инверсия правого мотора

            actualLeftForMotor = constrain(actualLeftForMotor, -100, 100);
            actualRightForMotor = constrain(actualRightForMotor, -100, 100);

            setPlatformSpeed(actualLeftForMotor, actualRightForMotor);

            currentLeftSpeed = actualLeftForMotor;
            currentRightSpeed = actualRightForMotor;
            lastCommand = "WS Drive (L:" + String(conceptualL) + " R:" + String(conceptualR) +
                          " -> M_L:" + String(actualLeftForMotor) + " M_R:" + String(actualRightForMotor) + ")";
            Serial.println(lastCommand);
            
            sendPlatformStatus(client); // Отправляем обновленный статус

          } else {
             sendWsError(client, "Drive command missing or invalid payload");
          }
        } else if (commandType.equals("get_status")) {
          sendPlatformStatus(client);
        } else {
          Serial.printf("Unknown WS command: %s\n", commandType.c_str());
          sendWsError(client, "Unknown command: " + commandType);
        }
      }
      break;
    }
    case WS_EVT_PONG:
      Serial.printf("WS Pong from client #%u\n", client->id());
      break;
    case WS_EVT_ERROR:
      Serial.printf("WebSocket client #%u error #%u: %s\n", client->id(), *((uint16_t*)arg), (char*)data);
      break;
  }
}


void setup() {
  Serial.begin(115200);
  delay(1000);

  ESP32PWM::allocateTimer(0);
  teaserServoLeft.setPeriodHertz(50);
  teaserServoLeft.attach(servoLeftPin, ATTACH_PWM_MIN_US, ATTACH_PWM_MAX_US);
  teaserServoRight.setPeriodHertz(50);
  teaserServoRight.attach(servoRightPin, ATTACH_PWM_MIN_US, ATTACH_PWM_MAX_US);

  Serial.println("--- Initializing Mobile Platform (WebSocket + ArduinoJson) ---");
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

  // ВАЖНО: Добавляем заголовок CORS по умолчанию.
  // Это позволит клиенту (веб-странице), загруженному с другого origin,
  // успешно установить WebSocket соединение.
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  // Для большей безопасности, если ваш JS клиент будет обслуживаться, например, Python сервером на порту 5000:
  // DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5000");


  // Настраиваем WebSocket сервер
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // HTTP эндпоинт для отдачи HTML страницы
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send_P(200, "text/html", index_html);
  });

  // Старые HTTP эндпоинты /drive и /status теперь не нужны для основного управления
  // Оставляем их закомментированными или удаляем
  /*
  server.on("/drive", HTTP_GET, [](AsyncWebServerRequest *request){
    // ... (старый код с processDriveCommand)
  });
  
  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *request){
    // ... (старый код)
  });
  */

  server.begin();
  Serial.println("HTTP server with WebSocket (ArduinoJson) started.");
}

unsigned long lastStatusUpdateTime = 0;
const long statusUpdateInterval = 200; // Отправлять статус каждые 200 мс

void loop() {
  unsigned long currentTime = millis();
  if (currentTime - lastStatusUpdateTime > statusUpdateInterval) {
    lastStatusUpdateTime = currentTime;
    if (ws.count() > 0) { // Если есть подключенные клиенты
      // Создаем JSON для статуса
      StaticJsonDocument<256> doc; // Документ для исходящего JSON
      doc["type"] = "status_update";
      JsonObject data = doc.createNestedObject("data");
      data["motorL"] = currentLeftSpeed;
      data["motorR"] = currentRightSpeed;
      // data["lastCommand"] = lastCommand; // Раскомментируйте, если нужно, но может быть длинным для частых обновлений

      String output;
      serializeJson(doc, output);
      ws.textAll(output); // Отправляем всем подключенным клиентам
    }
  }
  ws.cleanupClients(); // Важно для корректной работы AsyncWebSocket
  delay(10); 
}