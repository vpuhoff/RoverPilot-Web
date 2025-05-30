// --- Глобальные/модульные переменные для DOM элементов ---
let logOutputElement = null;
let loaderContainerElement = null; // Changed from loaderElement

// --- Камера ---
let videoStreamImgElement = null; // Для MJPEG
let cameraIpInput, rtspUrlInput, onvifUserInput, onvifPasswordInput, cameraTypeSelect, invertUpDownCheckbox, startStreamButton;
// ONVIF and RTSP config variables (populated by updateCameraConfigValues)
let ONVIF_HOST_CONFIG, ONVIF_USER_CONFIG, ONVIF_PASSWORD_CONFIG, RTSP_URL_CONFIG, SELECTED_CAMERA_TYPE_NAME_CONFIG, IS_INVERT_UPDOWN_PTZ_CONFIG;
const PTZ_MOVE_TIME_MS = 0.4 * 1000; // Duration for continuous move before auto-stop
const CAMERA_PAN_SPEED_CONFIG = 0.5;
const CAMERA_TILT_SPEED_CONFIG = 0.5;
const CAMERA_ZOOM_SPEED_CONFIG = 0.5;
const BACKEND_BASE_URL = 'http://localhost:5000'; // URL вашего Flask бэкенда
let ptzMoveTimeoutId = null;
let isCurrentlyMovingPtz = false;

// --- Платформа ---
let platformControllerInstance;
let platformIpInputElem; // Now in config panel
let platformThrottleBar, platformThrottleValue, platformThrottleBarText;
let platformSteeringBar, platformSteeringValue, platformSteeringBarText;
let platformActualLeftElem, platformActualRightElem; // Corrected names
let platformKeysPressedElem;
let platformNotificationElem; // Element to display notifications
let platformHandbrakeButton;
let platformConnectionStatusElem; // For WebSocket status

// --- Configuration Panel ---
let toggleConfigButton, closeConfigButton, configPanelContainer;

// --- WebRTC Глобальные переменные ---
let pc = null; // RTCPeerConnection
let webRtcVideoElement = null; // Для WebRTC видео
const RtcPeerConnectionConfig = {
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' }
        // {
        //   'urls': 'turn:your.turn.server:3478',
        //   'username': 'user',
        //   'credential': 'password'
        // }
    ]
};


// --- Функции Логирования и UI (Общие) ---
function logger(message, type = 'info') {
    if (!logOutputElement) {
        console[type === 'error' ? 'error' : 'log'](`(Log Elem Not Ready) ${type.toUpperCase()}: ${message}`);
        return;
    }
    // Clear placeholder if it exists
    const placeholder = logOutputElement.querySelector('.log-placeholder');
    if (placeholder) {
        logOutputElement.removeChild(placeholder);
    }

    const now = new Date().toLocaleTimeString();
    const p = document.createElement('p');
    p.textContent = `[${now}] ${type.toUpperCase()}: ${message}`;

    if (type === 'error') p.classList.add('hud-text-error');
    else if (type === 'success') p.classList.add('hud-text-success');
    else p.classList.add('hud-text-secondary');

    logOutputElement.appendChild(p);
    logOutputElement.scrollTop = logOutputElement.scrollHeight; // Auto-scroll
    console[type === 'error' ? 'error' : 'log'](message);
}

function showLoader() {
    if (loaderContainerElement) loaderContainerElement.classList.remove('hidden');
}

function hideLoader() {
    if (loaderContainerElement) loaderContainerElement.classList.add('hidden');
}

// --- Функции для Управления Камерой (ONVIF PTZ) ---
function updateCameraConfigValues() {
    if (!cameraIpInput || !onvifUserInput || !onvifPasswordInput || !rtspUrlInput || !cameraTypeSelect || !invertUpDownCheckbox) {
        // This can happen if called before DOM is fully parsed or elements are missing
        logger("Camera config elements not all found during updateCameraConfigValues attempt.", "error");
        return;
    }
    ONVIF_HOST_CONFIG = cameraIpInput.value;
    ONVIF_USER_CONFIG = onvifUserInput.value;
    ONVIF_PASSWORD_CONFIG = onvifPasswordInput.value;
    RTSP_URL_CONFIG = rtspUrlInput.value;
    SELECTED_CAMERA_TYPE_NAME_CONFIG = cameraTypeSelect.value;
    IS_INVERT_UPDOWN_PTZ_CONFIG = invertUpDownCheckbox.checked;
    // logger("Конфигурация камеры обновлена."); // Can be noisy if called often
}

async function sendCameraPtzRequestToBackend(ptzAction, panSpeed = 0, tiltSpeed = 0, zoomSpeed = 0) {
    showLoader();
    const requestUrl = `${BACKEND_BASE_URL}/api/ptz`;
    const payload = {
        camera_ip: ONVIF_HOST_CONFIG,
        onvif_user: ONVIF_USER_CONFIG,
        onvif_password: ONVIF_PASSWORD_CONFIG,
        camera_type: SELECTED_CAMERA_TYPE_NAME_CONFIG,
        action: ptzAction
    };

    if (ptzAction === 'move') {
        payload.pan = panSpeed;
        payload.tilt = tiltSpeed;
        payload.zoom = zoomSpeed;
    }

    logger(`Камера: Отправка PTZ ${ptzAction} на ${requestUrl}`);
    try {
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const responseData = await response.json();
        if (response.ok && responseData.status === 'success') {
            logger(`Камера: PTZ ${ptzAction} успешно: ${responseData.message}`, 'success');
        } else {
            logger(`Камера: Ошибка PTZ ${ptzAction}: ${responseData.message || `HTTP ${response.status}`}. Детали: ${responseData.details || ''}`, 'error');
        }
    } catch (e) {
        logger(`Камера: Исключение при PTZ ${ptzAction}: ${e.message}`, 'error');
    } finally {
        hideLoader();
    }
}

async function cameraPtzStopCommand() {
    await sendCameraPtzRequestToBackend('stop');
}

async function cameraPtzContinuousMoveCommand(x, y, z) {
    await sendCameraPtzRequestToBackend('move', x, y, z);
}

function startCameraPtzMovement(x, y, z) {
    if (ptzMoveTimeoutId) clearTimeout(ptzMoveTimeoutId);
    isCurrentlyMovingPtz = true;
    cameraPtzContinuousMoveCommand(x, y, z);
    ptzMoveTimeoutId = setTimeout(() => {
        if (isCurrentlyMovingPtz) {
            // logger("Камера: Авто-остановка PTZ движения."); // Can be verbose
            cameraPtzStopCommand();
            isCurrentlyMovingPtz = false;
        }
    }, PTZ_MOVE_TIME_MS);
}

function stopCameraPtzMovement() {
    if (ptzMoveTimeoutId) clearTimeout(ptzMoveTimeoutId);
    if (isCurrentlyMovingPtz) {
        cameraPtzStopCommand();
        isCurrentlyMovingPtz = false;
    }
}

// --- Функции для Управления Платформой ---

// HUD-style notification (already provided by user, assumed to be this version)
function showPlatformNotification(message, type, duration = 3000) {
    if (!platformNotificationElem) return;

    platformNotificationElem.textContent = message;
    platformNotificationElem.classList.remove('hud-text-success', 'hud-text-error', 'hud-text-warning', 'hud-text-secondary');

    if (type === 'success') platformNotificationElem.classList.add('hud-text-success');
    else if (type === 'error') platformNotificationElem.classList.add('hud-text-error');
    else platformNotificationElem.classList.add('hud-text-secondary'); // Default color

    if (platformNotificationElem.timer) clearTimeout(platformNotificationElem.timer);
    if (duration > 0) { // if duration is 0 or less, message stays until next call
        platformNotificationElem.timer = setTimeout(() => {
            platformNotificationElem.textContent = ''; // Clear message after duration
        }, duration);
    }
}


function updatePlatformUI(state) {
    // Throttle Bar
    if (platformThrottleBar && platformThrottleValue && platformThrottleBarText && platformControllerInstance) {
        let throttlePercent = (state.throttle / platformControllerInstance.config.MAX_THROTTLE) * 50; // 0-50% for one direction
        platformThrottleBar.style.width = Math.abs(throttlePercent * 2) + '%'; // Scale to 0-100% width
        if (state.throttle >= 0) {
            platformThrottleBar.style.left = '50%';
            platformThrottleBar.style.backgroundColor = '#22c55e'; // Green (from custom CSS)
        } else {
            platformThrottleBar.style.left = (50 - Math.abs(throttlePercent * 2)) + '%';
            platformThrottleBar.style.backgroundColor = '#ef4444'; // Red
        }
        platformThrottleValue.textContent = `${Math.round(state.throttle)}%`;
        platformThrottleBarText.textContent = `${Math.round(state.throttle)}%`;
    }

    // Steering Bar
    if (platformSteeringBar && platformSteeringValue && platformSteeringBarText && platformControllerInstance) {
        let steeringPercent = (state.steering / platformControllerInstance.config.MAX_STEERING) * 50;
        platformSteeringBar.style.width = Math.abs(steeringPercent * 2) + '%';
        if (state.steering >= 0) {
            platformSteeringBar.style.left = '50%';
        } else {
            platformSteeringBar.style.left = (50 - Math.abs(steeringPercent * 2)) + '%';
        }
        platformSteeringValue.textContent = `${Math.round(state.steering)}`;
        platformSteeringBarText.textContent = `${Math.round(state.steering)}`;
    }

    // ESP L/R Motor Values
    if (platformActualLeftElem && platformActualRightElem) {
        if (state.lastError) {
            platformActualLeftElem.textContent = "Err";
            platformActualRightElem.textContent = "Err";
        } else if (state.lastReceivedData && typeof state.lastReceivedData.motorL !== 'undefined') {
            platformActualLeftElem.textContent = state.lastReceivedData.motorL;
            platformActualRightElem.textContent = state.lastReceivedData.motorR;
        } else {
            platformActualLeftElem.textContent = "N/A";
            platformActualRightElem.textContent = "N/A";
        }
    }

    // Keys Pressed
    if (platformKeysPressedElem) {
        platformKeysPressedElem.textContent = Object.keys(state.keysPressed).join(', ') || 'None';
    }

    // Handbrake Button
    if (platformHandbrakeButton) {
        if (state.handbrakeOn) {
            platformHandbrakeButton.classList.add('hud-button-critical');
            platformHandbrakeButton.textContent = "РУЧНИК ВКЛ (Пробел)";
        } else {
            platformHandbrakeButton.classList.remove('hud-button-critical');
            platformHandbrakeButton.textContent = "РУЧНИК (Пробел)";
        }
    }

    // Display errors from PlatformController state
    if (state.lastError && state.lastError.message) {
        if(platformNotificationElem && platformNotificationElem.textContent !== state.lastError.message) {
             showPlatformNotification(state.lastError.message, 'error', 5000);
        }
    }
}

function updatePlatformConnectionStatusDisplay(status) {
    if (!platformConnectionStatusElem) return;

    if (status.isAttemptingConnection) {
        platformConnectionStatusElem.textContent = "ПОДКЛ...";
        platformConnectionStatusElem.className = "status-indicator connecting";
    } else if (status.isConnected) {
        platformConnectionStatusElem.textContent = "ОНЛАЙН";
        platformConnectionStatusElem.className = "status-indicator connected";
    } else {
        platformConnectionStatusElem.textContent = "ОФФЛАЙН";
        platformConnectionStatusElem.className = "status-indicator disconnected";
        if (!status.wsUrl || status.wsUrl === '') {
           showPlatformNotification("URL платформы не задан. Проверьте настройки.", "error", 0);
        }
    }
}

// --- WebRTC Функции ---
function createPeerConnection() {
    logger("WebRTC: Создание PeerConnection...");
    pc = new RTCPeerConnection(RtcPeerConnectionConfig);

    pc.onicecandidate = event => {
        if (event.candidate) {
            logger("WebRTC: Новый ICE кандидат от клиента: " + event.candidate.candidate.substring(0, 30) + "...");
            // TODO: Отправить event.candidate на сервер (например, через WebSocket)
            // Пример: sendToServerViaWebSocket({ type: 'ice-candidate', payload: event.candidate.toJSON() });
            console.log("КЛИЕНТ: Кандидат для отправки на сервер:", event.candidate.toJSON());
        } else {
            logger("WebRTC: Сбор ICE кандидатов от клиента завершен.");
        }
    };

    pc.ontrack = event => {
        logger("WebRTC: Получен удаленный трек: " + event.track.kind);
        if (event.streams && event.streams[0]) {
            if (webRtcVideoElement) {
                webRtcVideoElement.srcObject = event.streams[0];
                logger("WebRTC: Удаленный поток привязан к video элементу.");
            } else {
                logger("WebRTC: Video элемент не найден для привязки потока.", "error");
            }
        } else {
            let inboundStream = new MediaStream();
            inboundStream.addTrack(event.track);
            if (webRtcVideoElement) {
                webRtcVideoElement.srcObject = inboundStream;
                logger("WebRTC: Удаленный трек привязан к video элементу (через новый MediaStream).");
            }
        }
    };

    pc.oniceconnectionstatechange = event => {
        logger("WebRTC: Состояние ICE соединения: " + pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
            logger("WebRTC: Соединение потеряно или закрыто.", "error");
            showPlatformNotification("WebRTC: Соединение разорвано", "error");
        }
    };

    pc.onconnectionstatechange = event => {
        logger("WebRTC: Состояние соединения: " + pc.connectionState);
         if (pc.connectionState === "connected") {
            logger("WebRTC: Соединение установлено!", "success");
            showPlatformNotification("WebRTC: Видео подключено", "success");
            // Если MJPEG стрим был активен, его можно скрыть или остановить
            if (videoStreamImgElement) videoStreamImgElement.src = "https://placehold.co/1920x1080/0a0f18/1e293b?text=WebRTC+Active";

        }
    };
    return pc;
}

async function startWebRtcStream() {
    if (!webRtcVideoElement) {
        logger("WebRTC: HTML video элемент 'webRtcVideoElement' не найден.", "error");
        showPlatformNotification("Ошибка: Video элемент для WebRTC не найден.", "error");
        return;
    }

    if (pc && (pc.connectionState === "connected" || pc.connectionState === "connecting")) {
        logger("WebRTC: Попытка запустить стрим, когда соединение уже есть или устанавливается. Игнорируем.", "warning");
        return;
    }
    
    if (pc) {
        logger("WebRTC: Закрытие предыдущего PeerConnection...");
        try { pc.close(); } catch (e) { /* Игнор */ }
    }
    pc = createPeerConnection();

    pc.addTransceiver('video', { 'direction': 'recvonly' });

    try {
        logger("WebRTC: Создание Offer...");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        logger("WebRTC: LocalDescription (Offer) установлен.");

        logger("WebRTC: Отправка Offer на сервер...");
        showLoader(); // Показываем лоадер на время запроса
        const response = await fetch(`${BACKEND_BASE_URL}/offer`, { // Используем BACKEND_BASE_URL
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sdp: offer.sdp,
                type: offer.type,
                // rtsp_url: RTSP_URL_CONFIG // Если сервер должен знать RTSP URL с клиента
            })
        });
        hideLoader(); // Скрываем лоадер

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ошибка сервера при отправке Offer: ${response.status} ${errorText}`);
        }

        const answer = await response.json();
        logger("WebRTC: Получен Answer от сервера.");
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        logger("WebRTC: RemoteDescription (Answer) установлен.");

    } catch (e) {
        logger("WebRTC: Ошибка при старте стрима: " + e, "error");
        showPlatformNotification("WebRTC: Ошибка старта: " + e.message, "error");
        if (pc) { try { pc.close(); } catch (eClose) { /* Игнор */ } pc = null; }
        hideLoader();
    }
}

function stopWebRtcStream() {
    if (pc) {
        logger("WebRTC: Остановка стрима и закрытие PeerConnection...");
        pc.close();
        pc = null;
    }
    if (webRtcVideoElement) {
        webRtcVideoElement.srcObject = null;
        webRtcVideoElement.load(); // Сброс video элемента
    }
    showPlatformNotification("WebRTC: Видео остановлено", "info");
}

// TODO: Эта функция должна вызываться, когда сервер присылает ICE кандидат (например, через WebSocket)
function addIceCandidateFromServer(candidateData) {
    if (pc) {
        const candidate = new RTCIceCandidate(candidateData);
        pc.addIceCandidate(candidate)
            .then(() => {
                logger("WebRTC: ICE кандидат от сервера успешно добавлен: " + candidate.candidate.substring(0,30) + "...");
            })
            .catch(e => {
                logger("WebRTC: Ошибка добавления ICE кандидата от сервера: " + e, "error");
            });
    } else {
        logger("WebRTC: PeerConnection не существует для добавления ICE кандидата от сервера.", "warning");
    }
}


// --- Инициализация и общие обработчики событий ---
document.addEventListener('DOMContentLoaded', () => {
    // Общие элементы
    logOutputElement = document.getElementById('logOutput');
    if (logOutputElement && logOutputElement.querySelector('.text-gray-500.italic')) {
         logOutputElement.innerHTML = '<p class="log-placeholder text-gray-500 text-xs italic">Логи инициализации...</p>';
    }

    loaderContainerElement = document.getElementById('loaderContainer');
    platformConnectionStatusElem = document.getElementById('platformConnectionStatus');

    // Config Panel Elements
    toggleConfigButton = document.getElementById('toggleConfigButton');
    closeConfigButton = document.getElementById('closeConfigButton');
    configPanelContainer = document.getElementById('config-panel-container');

    if (toggleConfigButton && closeConfigButton && configPanelContainer) {
        toggleConfigButton.addEventListener('click', () => configPanelContainer.classList.remove('hidden'));
        closeConfigButton.addEventListener('click', () => configPanelContainer.classList.add('hidden'));
        configPanelContainer.addEventListener('click', (event) => {
            if (event.target === configPanelContainer) configPanelContainer.classList.add('hidden');
        });
    } else {
        logger("Элементы управления панелью конфигурации не найдены!", "error");
    }

    // --- Инициализация Камеры (элементы в Config Panel) ---
    videoStreamImgElement = document.getElementById('videoStream'); // Для MJPEG
    webRtcVideoElement = document.getElementById('webRtcVideoStream'); // Для WebRTC

    cameraIpInput = document.getElementById('cameraIp');
    rtspUrlInput = document.getElementById('rtspUrl');
    onvifUserInput = document.getElementById('onvifUser');
    onvifPasswordInput = document.getElementById('onvifPassword');
    cameraTypeSelect = document.getElementById('cameraType');
    invertUpDownCheckbox = document.getElementById('invertUpDown');
    startStreamButton = document.getElementById('startStreamButton'); // Эта кнопка теперь будет для WebRTC

    if (!videoStreamImgElement || !webRtcVideoElement || !cameraIpInput || !rtspUrlInput || !onvifUserInput || !onvifPasswordInput || !cameraTypeSelect || !invertUpDownCheckbox || !startStreamButton) {
        logger("КРИТИЧЕСКАЯ ОШИБКА: Не все HTML-элементы для камеры и видео найдены!", "error");
    } else {
        updateCameraConfigValues();
        [cameraIpInput, onvifUserInput, onvifPasswordInput, rtspUrlInput, cameraTypeSelect, invertUpDownCheckbox].forEach(el => {
            el.addEventListener('change', updateCameraConfigValues);
        });

        // Переназначаем startStreamButton для WebRTC
        startStreamButton.addEventListener('click', () => {
            logger("Кнопка 'Запустить видео' нажата, инициируем WebRTC стрим.");
            updateCameraConfigValues(); // Убедимся, что RTSP_URL_CONFIG актуален, если сервер его ждет
            
            // Если вы хотите использовать MJPEG как fallback или для отладки,
            // можно оставить старую логику здесь под условием или для другой кнопки.
            // videoStreamImgElement.src = `${BACKEND_BASE_URL}/api/video-stream?rtsp=${encodeURIComponent(RTSP_URL_CONFIG)}`;
            
            startWebRtcStream();
        });
    }

    const ptzControlConfig = [
        { id: 'ptzUp',    key: 'arrowup',    action: () => startCameraPtzMovement(0, IS_INVERT_UPDOWN_PTZ_CONFIG ? -CAMERA_TILT_SPEED_CONFIG : CAMERA_TILT_SPEED_CONFIG, 0) },
        { id: 'ptzDown',  key: 'arrowdown',  action: () => startCameraPtzMovement(0, IS_INVERT_UPDOWN_PTZ_CONFIG ? CAMERA_TILT_SPEED_CONFIG : -CAMERA_TILT_SPEED_CONFIG, 0) },
        { id: 'ptzLeft',  key: 'arrowleft',  action: () => startCameraPtzMovement(CAMERA_PAN_SPEED_CONFIG, 0, 0) },
        { id: 'ptzRight', key: 'arrowright', action: () => startCameraPtzMovement(-CAMERA_PAN_SPEED_CONFIG, 0, 0) },
        { id: 'ptzZoomIn',key: 'z',          action: () => startCameraPtzMovement(0, 0, CAMERA_ZOOM_SPEED_CONFIG) },
        { id: 'ptzZoomOut',key: 'x',         action: () => startCameraPtzMovement(0, 0, -CAMERA_ZOOM_SPEED_CONFIG) }
    ];

    ptzControlConfig.forEach(ctrl => {
        const button = document.getElementById(ctrl.id);
        if (button) {
            button.addEventListener('mousedown', ctrl.action);
            button.addEventListener('touchstart', (e) => { e.preventDefault(); ctrl.action(); }, { passive: false });
            button.addEventListener('mouseup', stopCameraPtzMovement);
            button.addEventListener('mouseleave', stopCameraPtzMovement);
            button.addEventListener('touchend', stopCameraPtzMovement);
            button.addEventListener('touchcancel', stopCameraPtzMovement);
        } else {
            logger(`Камера: Кнопка PTZ с ID '${ctrl.id}' не найдена.`, 'error');
        }
    });

    const cameraStopButton = document.getElementById('ptzStop');
    if (cameraStopButton) {
        cameraStopButton.addEventListener('click', stopCameraPtzMovement);
    } else {
        logger("Камера: Кнопка 'ptzStop' не найдена.", 'error');
    }

    // --- Инициализация Платформы ---
    platformIpInputElem = document.getElementById('platformIp');
    platformThrottleBar = document.getElementById('platformThrottleBar');
    platformThrottleValue = document.getElementById('platformThrottleValue');
    platformThrottleBarText = document.getElementById('platformThrottleBarText');
    platformSteeringBar = document.getElementById('platformSteeringBar');
    platformSteeringValue = document.getElementById('platformSteeringValue');
    platformSteeringBarText = document.getElementById('platformSteeringBarText');
    platformActualLeftElem = document.getElementById('platformActualLeft');
    platformActualRightElem = document.getElementById('platformActualRight');
    platformKeysPressedElem = document.getElementById('platformKeysPressed');
    platformNotificationElem = document.getElementById('platformNotification');
    platformHandbrakeButton = document.getElementById('platformHandbrake');

    if (!platformIpInputElem || !platformThrottleBar || !platformSteeringBar || !platformHandbrakeButton || !platformActualLeftElem || !platformActualRightElem || !platformKeysPressedElem || !platformNotificationElem) {
         logger("КРИТИЧЕСКАЯ ОШИБКА: Не все HTML-элементы для управления платформой найдены!", "error");
    } else {
        const initialPlatformIp = platformIpInputElem.value || "192.168.0.155";
        const platformConfig = {
            wsUrl: initialPlatformIp ? `ws://${initialPlatformIp}/ws` : '',
            onUpdate: updatePlatformUI,
            onConnectionStatusChange: updatePlatformConnectionStatusDisplay,
        };

        try {
            platformControllerInstance = new PlatformController(platformConfig);
            platformControllerInstance.start();
            logger("Контроллер платформы инициализирован.");
        } catch (e) {
            logger(`Ошибка инициализации PlatformController: ${e.message}`, "error");
            alert(`Ошибка инициализации PlatformController: ${e.message}. Убедитесь, что PlatformController.js загружен.`);
            return;
        }
        
        platformIpInputElem.addEventListener('change', () => {
            if (platformControllerInstance) {
                const newIp = platformIpInputElem.value;
                const newWsUrl = newIp ? `ws://${newIp}/ws` : '';
                platformControllerInstance.setWsUrl(newWsUrl);
                logger(`Платформа: WebSocket URL установлен на: ${newWsUrl || '(пусто)'}`);
            }
        });

        platformHandbrakeButton.addEventListener('click', () => {
            if (platformControllerInstance) platformControllerInstance.toggleHandbrake();
        });
    }

    // --- Общие обработчики клавиатуры ---
    const platformKeys = ['w', 'a', 's', 'd'];
    const platformActionKeys = [' '];
    const cameraArrowKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const cameraZoomKeys = ['z', 'x'];

    document.addEventListener('keydown', (event) => {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA')) {
            if (event.key === ' ' && document.activeElement.tagName !== 'TEXTAREA') {
                // Allow space
            } else {
                return;
            }
        }
        
        const key = event.key.toLowerCase();
        let handled = false;

        if (platformControllerInstance) {
            if (platformKeys.includes(key)) {
                platformControllerInstance.pressKey(key);
                handled = true;
            } else if (platformActionKeys.includes(key)) {
                if (key === ' ') platformControllerInstance.toggleHandbrake();
                handled = true;
            }
        }
        
        if (cameraArrowKeys.includes(key) || cameraZoomKeys.includes(key)) {
            if (!isCurrentlyMovingPtz) {
                const control = ptzControlConfig.find(c => c.key === key);
                if (control) {
                    control.action();
                    handled = true;
                }
            }
        }
        
        if (handled) {
            event.preventDefault();
        }
    });

    document.addEventListener('keyup', (event) => {
        const key = event.key.toLowerCase();
        // let handled = false; // Not strictly needed for keyup if not preventing default

        if (platformControllerInstance && platformKeys.includes(key)) {
            platformControllerInstance.releaseKey(key);
            // handled = true;
        }
        
        if (cameraArrowKeys.includes(key) || cameraZoomKeys.includes(key)) {
             if (isCurrentlyMovingPtz) {
                const control = ptzControlConfig.find(c => c.key === key);
                if (control) { 
                    stopCameraPtzMovement();
                    // handled = true;
                }
            }
        }
    });

    logger("Полная инициализация интерфейса завершена.");
    hideLoader();
});
