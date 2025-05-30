// --- Глобальные/модульные переменные для DOM элементов ---
let logOutputElement = null;
let loaderContainerElement = null; // Changed from loaderElement

// --- Камера ---
let videoStreamImgElement = null;
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

// HUD-style notification
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
            platformHandbrakeButton.classList.add('hud-button-critical'); // Assuming this class makes it look "active" or red
            platformHandbrakeButton.textContent = "РУЧНИК ВКЛ (Пробел)";
        } else {
            platformHandbrakeButton.classList.remove('hud-button-critical');
            platformHandbrakeButton.textContent = "РУЧНИК (Пробел)";
        }
    }
    
    // Display errors from PlatformController state
    if (state.lastError && state.lastError.message) {
        // Check if the notification is already showing this error to avoid repetition if onUpdate is frequent
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
        // platformConnectionStatusElem.textContent = `К ${status.wsUrl.replace(/ws:\/\//i, '').replace(/\/ws/i, '')}`; // Shorter URL
        platformConnectionStatusElem.textContent = "ОНЛАЙН";
        platformConnectionStatusElem.className = "status-indicator connected";
    } else {
        platformConnectionStatusElem.textContent = "ОФФЛАЙН";
        platformConnectionStatusElem.className = "status-indicator disconnected";
        if (!status.wsUrl || status.wsUrl === '') {
           showPlatformNotification("URL платформы не задан. Проверьте настройки.", "error", 0); // Persistent until URL set
        }
    }
}

// Update platform notification styling
function showPlatformNotification(message, type, duration = 3000) {
    const platformNotificationElem = document.getElementById('platformNotification');
    if (!platformNotificationElem) return;
    
    platformNotificationElem.textContent = message;
    platformNotificationElem.classList.remove('hud-text-success', 'hud-text-error', 'hud-text-warning'); // Clear previous types

    if (type === 'success') platformNotificationElem.classList.add('hud-text-success');
    else if (type === 'error') platformNotificationElem.classList.add('hud-text-error');
    else platformNotificationElem.classList.add('hud-text-secondary'); // Default
    
    // No need to manage display: block/none as it's always visible in its panel
    // If you want timed removal of text:
    if (platformNotificationElem.timer) clearTimeout(platformNotificationElem.timer);
    if (duration > 0) {
        platformNotificationElem.timer = setTimeout(() => {
            platformNotificationElem.textContent = '';
        }, duration);
    }
}

// --- Инициализация и общие обработчики событий ---
document.addEventListener('DOMContentLoaded', () => {
    // Общие элементы
    logOutputElement = document.getElementById('logOutput');
    if (logOutputElement && logOutputElement.innerHTML.trim() === '<p class="text-gray-500 text-xs italic">Логи будут здесь...</p>') {
        // Keep placeholder or clear it: logOutputElement.innerHTML = '';
    } else if (logOutputElement) {
        // Clear any other default content if placeholder isn't there
        // logOutputElement.innerHTML = '';
    }


    loaderContainerElement = document.getElementById('loaderContainer');
    platformConnectionStatusElem = document.getElementById('platformConnectionStatus');

    // Config Panel Elements
    const toggleConfigButton = document.getElementById('toggleConfigButton');
    const closeConfigButton = document.getElementById('closeConfigButton');
    const configPanelContainer = document.getElementById('config-panel-container');

    console.log("toggleConfigButton:", toggleConfigButton);
    console.log("closeConfigButton:", closeConfigButton);
    console.log("configPanelContainer:", configPanelContainer);

    if (toggleConfigButton && closeConfigButton && configPanelContainer) {
        toggleConfigButton.addEventListener('click', () => {
            console.log("Кнопка 'Настройки' нажата - ПОКАЗЫВАЕМ панель");
            configPanelContainer.classList.remove('hidden');
        });
    
        closeConfigButton.addEventListener('click', () => {
            console.log("Кнопка 'Крестик' (closeConfigButton) нажата - СКРЫВАЕМ панель");
            configPanelContainer.classList.add('hidden');
        });
    
        configPanelContainer.addEventListener('click', (event) => {
            console.log("Клик по области configPanelContainer. event.target:", event.target);
            // event.currentTarget всегда будет configPanelContainer, если обработчик на нем.
            // Нам нужно проверить, был ли клик непосредственно по фону, а не по дочерним элементам.
            if (event.target === configPanelContainer) {
                console.log("Клик был по фону (event.target === configPanelContainer) - СКРЫВАЕМ панель");
                configPanelContainer.classList.add('hidden');
            } else {
                console.log("Клик был по дочернему элементу панели, не по фону.");
            }
        });
    } else {
        logger("Не удалось добавить обработчики для панели конфигурации, т.к. один из элементов (кнопки или контейнер) не найден.", "error");
    }
    

 
    // --- Инициализация Камеры (элементы в Config Panel) ---
    videoStreamImgElement = document.getElementById('videoStream');
    cameraIpInput = document.getElementById('cameraIp');
    rtspUrlInput = document.getElementById('rtspUrl');
    onvifUserInput = document.getElementById('onvifUser');
    onvifPasswordInput = document.getElementById('onvifPassword');
    cameraTypeSelect = document.getElementById('cameraType');
    invertUpDownCheckbox = document.getElementById('invertUpDown');
    startStreamButton = document.getElementById('startStreamButton');


    if (!videoStreamImgElement || !cameraIpInput || !rtspUrlInput || !onvifUserInput || !onvifPasswordInput || !cameraTypeSelect || !invertUpDownCheckbox || !startStreamButton) {
        logger("КРИТИЧЕСКАЯ ОШИБКА: Не все HTML-элементы для управления камерой найдены!", "error");
    } else {
        updateCameraConfigValues(); // Initial load of values
        [cameraIpInput, onvifUserInput, onvifPasswordInput, rtspUrlInput, cameraTypeSelect, invertUpDownCheckbox].forEach(el => {
            el.addEventListener('change', updateCameraConfigValues);
        });

        startStreamButton.addEventListener('click', () => {
            if (!RTSP_URL_CONFIG) {
                logger("Камера: RTSP URL не указан.", "error");
                showPlatformNotification("RTSP URL не указан в настройках!", "error");
                return;
            }
            const mjpegStreamUrl = `${BACKEND_BASE_URL}/api/video-stream?rtsp=${encodeURIComponent(RTSP_URL_CONFIG)}`;
            logger(`Камера: Загрузка видео с: ${mjpegStreamUrl}`);
            videoStreamImgElement.src = mjpegStreamUrl;
            videoStreamImgElement.onerror = () => {
                logger("Камера: Ошибка загрузки видеопотока.", "error");
                videoStreamImgElement.src = "https://placehold.co/1920x1080/0a0f18/334155?text=Ошибка+видеопотока%0A(проверьте+URL+и+сервер)";
                showPlatformNotification("Ошибка загрузки видеопотока!", "error");
            };
            videoStreamImgElement.onload = () => {
                 logger("Камера: Видеопоток успешно загружен (или начата загрузка).", "success");
                 // showPlatformNotification("Видеопоток запущен.", "success"); // Can be too much
            };
        });
    }

    const ptzControlConfig = [
        { id: 'ptzUp',    key: 'arrowup',    action: () => startCameraPtzMovement(0, IS_INVERT_UPDOWN_PTZ_CONFIG ? -CAMERA_TILT_SPEED_CONFIG : CAMERA_TILT_SPEED_CONFIG, 0) },
        { id: 'ptzDown',  key: 'arrowdown',  action: () => startCameraPtzMovement(0, IS_INVERT_UPDOWN_PTZ_CONFIG ? CAMERA_TILT_SPEED_CONFIG : -CAMERA_TILT_SPEED_CONFIG, 0) },
        { id: 'ptzLeft',  key: 'arrowleft',  action: () => startCameraPtzMovement(-CAMERA_PAN_SPEED_CONFIG, 0, 0) },
        { id: 'ptzRight', key: 'arrowright', action: () => startCameraPtzMovement(CAMERA_PAN_SPEED_CONFIG, 0, 0) },
        { id: 'ptzZoomIn',key: 'z',          action: () => startCameraPtzMovement(0, 0, CAMERA_ZOOM_SPEED_CONFIG) },
        { id: 'ptzZoomOut',key: 'x',         action: () => startCameraPtzMovement(0, 0, -CAMERA_ZOOM_SPEED_CONFIG) }
    ];

    ptzControlConfig.forEach(ctrl => {
        const button = document.getElementById(ctrl.id);
        if (button) {
            button.addEventListener('mousedown', ctrl.action);
            button.addEventListener('touchstart', (e) => { e.preventDefault(); ctrl.action(); }, { passive: false });
            button.addEventListener('mouseup', stopCameraPtzMovement);
            button.addEventListener('mouseleave', stopCameraPtzMovement); // Stop if mouse leaves button while pressed
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
    platformActualLeftElem = document.getElementById('platformActualLeft'); // Corrected
    platformActualRightElem = document.getElementById('platformActualRight'); // Corrected
    platformKeysPressedElem = document.getElementById('platformKeysPressed');
    platformNotificationElem = document.getElementById('platformNotification');
    platformHandbrakeButton = document.getElementById('platformHandbrake');

    if (!platformIpInputElem || !platformThrottleBar || !platformSteeringBar || !platformHandbrakeButton || !platformActualLeftElem || !platformActualRightElem || !platformKeysPressedElem || !platformNotificationElem) {
         logger("КРИТИЧЕСКАЯ ОШИБКА: Не все HTML-элементы для управления платформой найдены!", "error");
    } else {
        const initialPlatformIp = platformIpInputElem.value || "192.168.0.155"; // Default from input
        const platformConfig = {
            wsUrl: initialPlatformIp ? `ws://${initialPlatformIp}/ws` : '', // Formatted WS URL, or empty if IP is empty
            onUpdate: updatePlatformUI,
            onConnectionStatusChange: updatePlatformConnectionStatusDisplay,
            // controlParams: { MAX_THROTTLE: 80 } // Example
        };

        try {
            platformControllerInstance = new PlatformController(platformConfig);
            platformControllerInstance.start(); // Attempt to connect with initial or empty URL
            logger("Контроллер платформы инициализирован.");
        } catch (e) {
            logger(`Ошибка инициализации PlatformController: ${e.message}`, "error");
            alert(`Ошибка инициализации PlatformController: ${e.message}. Убедитесь, что PlatformController.js загружен.`);
            return; // Stop further execution if controller fails
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
    const platformActionKeys = [' ']; // Space for handbrake
    const cameraArrowKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const cameraZoomKeys = ['z', 'x']; // Kept from original for consistency

    document.addEventListener('keydown', (event) => {
        // Не обрабатывать, если фокус на инпуте (особенно в модальном окне настроек)
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA')) {
            // Allow Space key for handbrake even if an input has focus, unless it's a textarea
            if (event.key === ' ' && document.activeElement.tagName !== 'TEXTAREA') {
                 // Allow space if not textarea
            } else {
                return;
            }
        }
        
        const key = event.key.toLowerCase();
        let handled = false;

        // Управление платформой
        if (platformControllerInstance) {
            if (platformKeys.includes(key)) {
                platformControllerInstance.pressKey(key);
                handled = true;
            } else if (platformActionKeys.includes(key)) {
                if (key === ' ') platformControllerInstance.toggleHandbrake();
                handled = true;
            }
        }
        
        // Управление камерой (если панель конфигурации не активна, или если камера управляется всегда)
        // For simplicity, allow camera keys if not focused on general input. More complex focus management for config panel might be needed.
        if (cameraArrowKeys.includes(key) || cameraZoomKeys.includes(key)) {
            // Check if config panel is visible; if so, maybe disable camera keys?
            // For now, only disable if already moving PTZ by key.
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
        // No need to check for active input on keyup for releasing platform keys
        const key = event.key.toLowerCase();
        let handled = false;

        // Управление платформой
        if (platformControllerInstance && platformKeys.includes(key)) {
            platformControllerInstance.releaseKey(key);
            handled = true;
        }
        
        // Управление камерой
        if (cameraArrowKeys.includes(key) || cameraZoomKeys.includes(key)) {
             if (isCurrentlyMovingPtz) {
                const control = ptzControlConfig.find(c => c.key === key);
                if (control) { 
                    stopCameraPtzMovement();
                    handled = true;
                }
            }
        }
    });

    logger("Полная инициализация интерфейса завершена.");
    hideLoader(); // Ensure loader is hidden after all setup
});