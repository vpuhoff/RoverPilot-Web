class PlatformController {
    constructor(config = {}) {
        this.config = {
            MAX_THROTTLE: 100,
            MAX_STEERING: 100,
            THROTTLE_ACCELERATION: 5,
            THROTTLE_DECELERATION_NATURAL: 2,
            BRAKE_POWER: 6,
            STEERING_SPEED: 9,
            STEERING_RETURN_SPEED: 7,
            UPDATE_INTERVAL_MS: 50, // Интервал отправки команд на ESP32
            RECONNECT_INTERVAL_MS: 3000, // Интервал попыток переподключения
            ...(config.controlParams || {}) // Добавил проверку на undefined
        };

        this.wsConfig = {
            wsUrl: config.wsUrl || '', // Например, ws://192.168.0.155/ws
        };

        // Внутреннее состояние контроллера
        this.throttle = 0;
        this.steering = 0;
        this.handbrakeOn = false;
        this.keysPressed = {};
        this.conceptualLeft = 0;
        this.conceptualRight = 0;

        // Состояние WebSocket
        this.websocket = null;
        this.isConnected = false;
        this.isAttemptingConnection = false;
        this.reconnectTimeoutId = null;

        // Состояние коммуникации
        this.lastSentCommand = null;    // Последняя отправленная команда (объект)
        this.lastReceivedData = null; // Данные из последнего 'status_update' от ESP32
        this.lastError = null;          // Ошибки WebSocket или от ESP32

        // Callbacks
        this._onUpdateCallback = config.onUpdate || function() {}; // Вызывается с полным состоянием
        this._onConnectionStatusChangeCallback = config.onConnectionStatusChange || function() {}; // Вызывается при изменении статуса соединения

        this._updateIntervalId = null; // ID интервала для _controlLoop
    }

    // --- Управление WebSocket Соединением ---
    connect() {
        if (this.isConnected || this.isAttemptingConnection) {
            console.log("PlatformController: Попытка подключения уже выполняется или соединение установлено.");
            return;
        }
        if (!this.wsConfig.wsUrl) {
            this.lastError = { message: "WebSocket URL не установлен." };
            this._notifyUpdate();
            this._notifyConnectionStatusChange();
            console.error("PlatformController: WebSocket URL не установлен.");
            return;
        }

        this.isAttemptingConnection = true;
        this.lastError = null; // Очищаем предыдущие ошибки при новой попытке
        this._notifyConnectionStatusChange();
        console.log(`PlatformController: Попытка подключения к ${this.wsConfig.wsUrl}...`);

        try {
            this.websocket = new WebSocket(this.wsConfig.wsUrl);
        } catch (error) {
            console.error("PlatformController: Ошибка конструктора WebSocket:", error);
            this.lastError = { message: `Ошибка подключения WebSocket: ${error.message}`, details: error, isNetworkError: true };
            this.isAttemptingConnection = false;
            this.isConnected = false;
            this._notifyUpdate();
            this._notifyConnectionStatusChange();
            this._scheduleReconnect();
            return;
        }

        this.websocket.onopen = () => {
            console.log("PlatformController: WebSocket подключен.");
            this.isConnected = true;
            this.isAttemptingConnection = false;
            this.lastError = null;
            if (this.reconnectTimeoutId) {
                clearTimeout(this.reconnectTimeoutId);
                this.reconnectTimeoutId = null;
            }
            this._notifyConnectionStatusChange();
            this.getESPStatus(); // Запрашиваем начальный статус после подключения
        };

        this.websocket.onmessage = (event) => {
            // console.log("PlatformController: Получено сообщение WS:", event.data);
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'status_update' && message.data) {
                    this.lastReceivedData = message.data; // Например, { motorL: X, motorR: Y, lastCommand: "..." }
                } else if (message.type === 'error' && message.message) {
                    console.error("PlatformController: Сообщение об ошибке от ESP32:", message.message);
                    this.lastError = { message: `Ошибка ESP32: ${message.message}`, details: message, isAppError: true };
                } else {
                    console.warn("PlatformController: Неизвестный тип или формат сообщения от ESP32:", message);
                }
            } catch (e) {
                console.error("PlatformController: Ошибка парсинга сообщения WebSocket:", e);
                this.lastError = { message: `Ошибка парсинга WS сообщения: ${e.message}`, details: e };
            }
            this._notifyUpdate(); // Уведомляем UI о новых данных или ошибке
        };

        this.websocket.onerror = (errorEvent) => {
            console.error("PlatformController: Ошибка WebSocket:", errorEvent);
            this.lastError = { message: "Произошла ошибка WebSocket.", details: 'Generic WebSocket Error', isNetworkError: true };
            this.isAttemptingConnection = false; 
            this._notifyUpdate();
            this._notifyConnectionStatusChange();
        };

        this.websocket.onclose = (event) => {
            console.log(`PlatformController: WebSocket отключен. Код: ${event.code}, Причина: ${event.reason}, Чисто: ${event.wasClean}`);
            this.isConnected = false;
            this.isAttemptingConnection = false;
            if (!this.lastError || !this.lastError.isNetworkError && event.code !== 1000 /* Normal Closure */) {
                 this.lastError = { message: `WebSocket отключен (Код: ${event.code})`, details: event, isNetworkError: true };
            }
            this._notifyUpdate();
            this._notifyConnectionStatusChange();
            if (event.code !== 1000) { 
                this._scheduleReconnect();
            }
        };
    }

    _scheduleReconnect() {
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
        }
        if (!this.wsConfig.wsUrl) {
            console.log("PlatformController: Переподключение не запланировано, так как WebSocket URL не установлен.");
            return;
        }
        console.log(`PlatformController: Планирование переподключения через ${this.config.RECONNECT_INTERVAL_MS}мс...`);
        this.reconnectTimeoutId = setTimeout(() => {
            this.connect();
        }, this.config.RECONNECT_INTERVAL_MS);
    }

    disconnect() {
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
            console.log("PlatformController: Отменено запланированное переподключение.");
        }
        if (this.websocket) {
            console.log("PlatformController: Ручное отключение WebSocket.");
            this.websocket.onclose = null; 
            this.websocket.close(1000); 
            this.websocket = null;
        }
        this.isConnected = false;
        this.isAttemptingConnection = false;
        this._notifyConnectionStatusChange();
    }

    _sendWebSocketCommand(commandData) {
        if (!this.isConnected || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            const commandString = JSON.stringify(commandData);
            this.websocket.send(commandString);
            this.lastSentCommand = commandData; 
            return true;
        } catch (error) {
            console.error("PlatformController: Ошибка отправки команды WebSocket:", error);
            this.lastError = { message: `Ошибка отправки WS команды: ${error.message}`, details: error };
            this._notifyUpdate(); 
            return false;
        }
    }

    _updateSteering() {
        const keyA = 'a';
        const keyD = 'd';

        if (this.keysPressed[keyA]) {
            this.steering -= this.config.STEERING_SPEED;
        } else if (this.keysPressed[keyD]) {
            this.steering += this.config.STEERING_SPEED;
        } else {
            if (this.steering > this.config.STEERING_RETURN_SPEED) {
                this.steering -= this.config.STEERING_RETURN_SPEED;
            } else if (this.steering < -this.config.STEERING_RETURN_SPEED) {
                this.steering += this.config.STEERING_RETURN_SPEED;
            } else {
                this.steering = 0;
            }
        }
        this.steering = Math.max(-this.config.MAX_STEERING, Math.min(this.config.MAX_STEERING, this.steering));
    }

    _updateThrottle() {
        if (this.handbrakeOn) {
            this.throttle = 0;
            return;
        }
        const keyW = 'w';
        const keyS = 's';

        if (this.keysPressed[keyW]) {
            this.throttle += this.config.THROTTLE_ACCELERATION;
        } else if (this.keysPressed[keyS]) {
            this.throttle -= this.config.BRAKE_POWER;
        } else {
            if (this.throttle > this.config.THROTTLE_DECELERATION_NATURAL) {
                this.throttle -= this.config.THROTTLE_DECELERATION_NATURAL;
            } else if (this.throttle < -this.config.THROTTLE_DECELERATION_NATURAL) {
                this.throttle += this.config.THROTTLE_DECELERATION_NATURAL;
            } else {
                this.throttle = 0;
            }
        }
        this.throttle = Math.max(-this.config.MAX_THROTTLE, Math.min(this.config.MAX_THROTTLE, this.throttle));
    }

    _mixToMotorSpeeds() {
        let baseSpeed = this.throttle;
        let steeringAdjustment = this.steering;

        this.conceptualLeft = baseSpeed + steeringAdjustment;
        this.conceptualRight = baseSpeed - steeringAdjustment;

        const maxMagnitude = Math.max(Math.abs(this.conceptualLeft), Math.abs(this.conceptualRight));
        if (maxMagnitude > this.config.MAX_THROTTLE) {
            const scale = this.config.MAX_THROTTLE / maxMagnitude;
            this.conceptualLeft *= scale;
            this.conceptualRight *= scale;
        }

        this.conceptualLeft = Math.round(this.conceptualLeft);
        this.conceptualRight = Math.round(this.conceptualRight);
    }

    _controlLoop() {
        this._updateSteering();
        this._updateThrottle();
        this._mixToMotorSpeeds();

        const command = {
            command: "drive",
            payload: {
                left: this.conceptualLeft,
                right: this.conceptualRight
            }
        };
        
        if (this.isConnected) { 
            this._sendWebSocketCommand(command);
        }
        
        this._notifyUpdate(); 
    }
    
    _notifyUpdate() {
         if (this._onUpdateCallback) {
            this._onUpdateCallback(this.getCurrentState());
        }
    }

    _notifyConnectionStatusChange() {
        if (this._onConnectionStatusChangeCallback) {
            this._onConnectionStatusChangeCallback({
                isConnected: this.isConnected,
                isAttemptingConnection: this.isAttemptingConnection,
                wsUrl: this.wsConfig.wsUrl
            });
        }
        this._notifyUpdate();
    }

    setWsUrl(wsUrl) {
        if (wsUrl && !wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) { // Добавил проверку на пустой wsUrl
            console.error("PlatformController: Неверный WebSocket URL. Должен начинаться с ws:// или wss://. URL не установлен.");
            this.lastError = { message: "Неверный WebSocket URL. Должен начинаться с ws:// или wss://." };
            this.wsConfig.wsUrl = ''; 
            this._notifyConnectionStatusChange();
            return;
        }
        this.wsConfig.wsUrl = wsUrl;
        console.log(`PlatformController: WebSocket URL установлен: ${wsUrl}`);
        this.lastError = null; 

        if (this.isConnected || this.isAttemptingConnection || this.websocket) {
            console.log("PlatformController: WebSocket URL изменен, попытка переподключения к новому URL.");
            this.disconnect(); 
            if (this.wsConfig.wsUrl) { // Подключаемся только если новый URL не пустой
                 this.connect();    
            } else {
                this._notifyConnectionStatusChange(); // Обновить UI если URL был очищен
            }
        } else if (this.wsConfig.wsUrl) { // Если не были подключены, но URL задан
            this.connect();
        }
         else {
             this._notifyConnectionStatusChange(); 
        }
    }

    pressKey(key) {
        const lowerKey = key.toLowerCase();
        this.keysPressed[lowerKey] = true;
        this._notifyUpdate(); 
    }

    releaseKey(key) {
        delete this.keysPressed[key.toLowerCase()];
        this._notifyUpdate(); 
    }

    toggleHandbrake() {
        this.handbrakeOn = !this.handbrakeOn;
        if (this.handbrakeOn) {
            this.throttle = 0; 
            this.conceptualLeft = 0;
            this.conceptualRight = 0;
            if(this.isConnected) {
                this._sendWebSocketCommand({ command: "drive", payload: { left: 0, right: 0 } });
            }
        }
        this._notifyUpdate(); 
    }

    start() {
        if (this._updateIntervalId) { 
            this.stop();
        }
        console.log("PlatformController: Запуск...");
        if (this.wsConfig.wsUrl) { // Пытаемся подключиться только если URL задан
            this.connect(); 
        } else {
            console.warn("PlatformController: Не могу запустить, WebSocket URL не установлен.");
            this._notifyConnectionStatusChange(); // Обновить UI, что мы не подключены
        }
        
        this._updateIntervalId = setInterval(() => this._controlLoop(), this.config.UPDATE_INTERVAL_MS);
        console.log("PlatformController: Цикл управления запущен.");
    }

    stop() {
        console.log("PlatformController: Остановка...");
        if (this._updateIntervalId) {
            clearInterval(this._updateIntervalId);
            this._updateIntervalId = null;
            console.log("PlatformController: Цикл управления остановлен.");
        }
        
        if(this.isConnected && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this._sendWebSocketCommand({ command: "drive", payload: { left: 0, right: 0 } });
            console.log("PlatformController: Отправлена финальная команда остановки.");
        }

        this.disconnect(); 

        this.throttle = 0;
        this.steering = 0;
        this.conceptualLeft = 0;
        this.conceptualRight = 0;
        this.keysPressed = {};

        this._notifyUpdate(); 
        // _notifyConnectionStatusChange() вызовется из disconnect()
    }

    manualDrive(left, right) {
        this.conceptualLeft = Math.round(left);
        this.conceptualRight = Math.round(right);
        const success = this._sendWebSocketCommand({ command: "drive", payload: { left: this.conceptualLeft, right: this.conceptualRight } });
        this._notifyUpdate(); 
        return success; 
    }
    
    getESPStatus() {
        if (!this.isConnected) return false;
        const success = this._sendWebSocketCommand({ command: "get_status" });
        return success;
    }
    
    getCurrentState() { 
        return {
            throttle: this.throttle,
            steering: this.steering,
            conceptualLeft: this.conceptualLeft,
            conceptualRight: this.conceptualRight,
            handbrakeOn: this.handbrakeOn,
            keysPressed: { ...this.keysPressed }, 
            isConnected: this.isConnected,
            isAttemptingConnection: this.isAttemptingConnection,
            wsUrl: this.wsConfig.wsUrl,
            lastSentCommand: this.lastSentCommand,   
            lastReceivedData: this.lastReceivedData, 
            lastError: this.lastError,               
            isLoopRunning: !!this._updateIntervalId
        };
    }
}