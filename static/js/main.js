// --- Глобальные/модульные переменные для DOM элементов ---
let logOutputElement = null;
let loaderElement = null;

// --- Камера ---
let videoStreamImgElement = null;
let cameraIpInput, rtspUrlInput, onvifUserInput, onvifPasswordInput, cameraTypeSelect, invertUpDownCheckbox;
let ONVIF_HOST_CONFIG, ONVIF_USER_CONFIG, ONVIF_PASSWORD_CONFIG, RTSP_URL_CONFIG, SELECTED_CAMERA_TYPE_NAME_CONFIG, IS_INVERT_UPDOWN_PTZ_CONFIG;
const PTZ_MOVE_TIME_MS = 0.4 * 1000;
const CAMERA_PAN_SPEED_CONFIG = 0.5;
const CAMERA_TILT_SPEED_CONFIG = 0.5;
const CAMERA_ZOOM_SPEED_CONFIG = 0.5;
const BACKEND_BASE_URL = 'http://localhost:5000'; // URL вашего Flask бэкенда
let ptzMoveTimeoutId = null;
let isCurrentlyMovingPtz = false;

// --- Платформа ---
let platformControllerInstance;
let platformIpInputElem;
let platformThrottleBar, platformThrottleValue, platformThrottleBarText;
let platformSteeringBar, platformSteeringValue, platformSteeringBarText;
let platformSentLeftElem, platformSentRightElem;
let platformKeysPressedElem;
let platformNotificationElem;
let platformHandbrakeButton;


// --- Функции Логирования и UI (Общие) ---
function logger(message, type = 'info') {
    if (!logOutputElement) {
        console[type === 'error' ? 'error' : 'log'](`(Log Elem Not Ready) ${type.toUpperCase()}: ${message}`);
        return;
    }
    const now = new Date().toLocaleTimeString();
    const p = document.createElement('p');
    p.textContent = `[${now}] ${type.toUpperCase()}: ${message}`;
    if (type === 'error') p.style.color = 'red';
    else if (type === 'success') p.style.color = 'green';
    logOutputElement.appendChild(p);
    logOutputElement.scrollTop = logOutputElement.scrollHeight;
    console[type === 'error' ? 'error' : 'log'](message);
}

function showLoader() {
    if (loaderElement) loaderElement.style.display = 'block';
}

function hideLoader() {
    if (loaderElement) loaderElement.style.display = 'none';
}

// --- Функции для Управления Камерой (ONVIF PTZ) ---
function updateCameraConfigValues() {
    ONVIF_HOST_CONFIG = cameraIpInput.value;
    ONVIF_USER_CONFIG = onvifUserInput.value;
    ONVIF_PASSWORD_CONFIG = onvifPasswordInput.value;
    RTSP_URL_CONFIG = rtspUrlInput.value;
    SELECTED_CAMERA_TYPE_NAME_CONFIG = cameraTypeSelect.value;
    IS_INVERT_UPDOWN_PTZ_CONFIG = invertUpDownCheckbox.checked;
    logger("Конфигурация камеры обновлена.");
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

    logger(`Камера: Отправка PTZ команды: ${ptzAction} на ${requestUrl}`);
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
            logger("Камера: Авто-остановка PTZ движения.");
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
function updatePlatformUI(state) {
    if (!platformThrottleBar || !platformSteeringBar) return; // Guard if elements not ready

    // Обновление индикатора газа
    let throttlePercent = (state.throttle / platformControllerInstance.config.MAX_THROTTLE) * 50;
    platformThrottleBar.style.width = Math.abs(throttlePercent * 2) + '%';
    if (state.throttle >= 0) {
        platformThrottleBar.style.left = '50%';
        platformThrottleBar.style.backgroundColor = '#4CAF50'; // Green for forward
    } else {
        platformThrottleBar.style.left = (50 - Math.abs(throttlePercent * 2)) + '%';
        platformThrottleBar.style.backgroundColor = '#f44336'; // Red for reverse
    }
    platformThrottleValue.textContent = `${Math.round(state.throttle)}%`;
    platformThrottleBarText.textContent = `${Math.round(state.throttle)}%`;


    // Обновление индикатора руля
    let steeringPercent = (state.steering / platformControllerInstance.config.MAX_STEERING) * 50;
    platformSteeringBar.style.width = Math.abs(steeringPercent * 2) + '%';
    if (state.steering >= 0) {
        platformSteeringBar.style.left = '50%';
    } else {
        platformSteeringBar.style.left = (50 - Math.abs(steeringPercent * 2)) + '%';
    }
    platformSteeringValue.textContent = `${Math.round(state.steering)}`;
    platformSteeringBarText.textContent = `${Math.round(state.steering)}`;

    // Нажатые клавиши
    platformKeysPressedElem.textContent = Object.keys(state.keysPressed).join(', ') || 'None';

    // Кнопка ручного тормоза
    if (state.handbrakeOn) {
        platformHandbrakeButton.style.backgroundColor = '#ef4444'; // Red
        platformHandbrakeButton.textContent = "Handbrake ON (Пробел)";
    } else {
        platformHandbrakeButton.style.backgroundColor = '#6b7280'; // Gray
        platformHandbrakeButton.textContent = "Handbrake (Пробел)";
    }

    // Уведомления и отправленные значения
    if (state.lastError) {
        showPlatformNotification(`Ошибка: ${state.lastError.message}`, 'error');
        platformSentLeftElem.textContent = "Err";
        platformSentRightElem.textContent = "Err";
    } else if (state.lastSentData && state.lastSentData.actual_motor_L !== undefined) {
        platformSentLeftElem.textContent = state.lastSentData.actual_motor_L;
        platformSentRightElem.textContent = state.lastSentData.actual_motor_R;
        // Можно добавить короткое уведомление об успехе, но может быть слишком часто
        // showPlatformNotification(`Отправлено: L ${state.lastSentData.actual_motor_L}, R ${state.lastSentData.actual_motor_R}`, 'success', 1000);
    } else { // Если нет ошибки и нет данных (например, при инициализации)
        platformSentLeftElem.textContent = "N/A";
        platformSentRightElem.textContent = "N/A";
    }
}

function showPlatformNotification(message, type, duration = 3000) {
    if (!platformNotificationElem) return;
    platformNotificationElem.textContent = message;
    platformNotificationElem.className = `notification-area ${type}`;
    platformNotificationElem.style.display = 'block';
    if (platformNotificationElem.timer) clearTimeout(platformNotificationElem.timer);
    platformNotificationElem.timer = setTimeout(() => {
        platformNotificationElem.style.display = 'none';
    }, duration);
}


// --- Инициализация и общие обработчики событий ---
document.addEventListener('DOMContentLoaded', () => {
    // Общие элементы
    logOutputElement = document.getElementById('logOutput');
    loaderElement = document.getElementById('loader');

    // --- Инициализация Камеры ---
    videoStreamImgElement = document.getElementById('videoStream');
    cameraIpInput = document.getElementById('cameraIp');
    rtspUrlInput = document.getElementById('rtspUrl');
    onvifUserInput = document.getElementById('onvifUser');
    onvifPasswordInput = document.getElementById('onvifPassword');
    cameraTypeSelect = document.getElementById('cameraType');
    invertUpDownCheckbox = document.getElementById('invertUpDown');

    if (!videoStreamImgElement || !cameraIpInput || !rtspUrlInput || !onvifUserInput || !onvifPasswordInput || !cameraTypeSelect || !invertUpDownCheckbox) {
        logger("КРИТИЧЕСКАЯ ОШИБКА: Не все HTML-элементы для управления камерой найдены!", "error");
        alert("Ошибка: Не все элементы для управления камерой найдены.");
        return;
    }
    updateCameraConfigValues();
    [cameraIpInput, onvifUserInput, onvifPasswordInput, rtspUrlInput, cameraTypeSelect, invertUpDownCheckbox].forEach(el => {
        el.addEventListener('change', updateCameraConfigValues);
    });

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

    const startStreamButton = document.getElementById('startStreamButton');
    if (startStreamButton) {
        startStreamButton.addEventListener('click', () => {
            if (!RTSP_URL_CONFIG) {
                logger("Камера: RTSP URL не указан.", "error");
                alert("Пожалуйста, введите RTSP URL для видеопотока.");
                return;
            }
            const mjpegStreamUrl = `${BACKEND_BASE_URL}/api/video-stream?rtsp=${encodeURIComponent(RTSP_URL_CONFIG)}`;
            logger(`Камера: Попытка загрузить видео с: ${mjpegStreamUrl}`);
            videoStreamImgElement.src = mjpegStreamUrl;
            videoStreamImgElement.onerror = () => {
                logger("Камера: Ошибка загрузки видеопотока.", "error");
                videoStreamImgElement.src = "https://placehold.co/640x360/000000/FFFFFF?text=Ошибка+видео%0A(проверьте+URL)";
            };
            videoStreamImgElement.onload = () => {
                 logger("Камера: Видеопоток успешно загружен (или начата загрузка).", "success");
            };
        });
    } else {
        logger("Камера: Кнопка 'startStreamButton' не найдена.", 'error');
    }


    // --- Инициализация Платформы ---
    platformIpInputElem = document.getElementById('platformIp');
    platformThrottleBar = document.getElementById('platformThrottleBar');
    platformThrottleValue = document.getElementById('platformThrottleValue');
    platformThrottleBarText = document.getElementById('platformThrottleBarText');
    platformSteeringBar = document.getElementById('platformSteeringBar');
    platformSteeringValue = document.getElementById('platformSteeringValue');
    platformSteeringBarText = document.getElementById('platformSteeringBarText');
    platformSentLeftElem = document.getElementById('platformSentLeft');
    platformSentRightElem = document.getElementById('platformSentRight');
    platformKeysPressedElem = document.getElementById('platformKeysPressed');
    platformNotificationElem = document.getElementById('platformNotification');
    platformHandbrakeButton = document.getElementById('platformHandbrake');

    if (!platformIpInputElem || !platformThrottleBar || !platformSteeringBar || !platformHandbrakeButton) {
         logger("КРИТИЧЕСКАЯ ОШИБКА: Не все HTML-элементы для управления платформой найдены!", "error");
        alert("Ошибка: Не все элементы для управления платформой найдены.");
        return;
    }

    const platformConfig = {
        baseUrl: platformIpInputElem.value || "http://192.168.0.155", // Default or from input
        onUpdate: updatePlatformUI,
        // controlParams: { MAX_THROTTLE: 80 } // Example
    };
    try {
        platformControllerInstance = new PlatformController(platformConfig);
        platformControllerInstance.start();
        logger("Контроллер платформы инициализирован и запущен.");
    } catch (e) {
        logger(`Ошибка инициализации PlatformController: ${e.message}`, "error");
        alert(`Ошибка инициализации PlatformController: ${e.message}. Убедитесь, что PlatformController.js загружен.`);
        return;
    }
    

    platformIpInputElem.addEventListener('change', () => {
        if (platformControllerInstance) {
            platformControllerInstance.setBaseUrl(platformIpInputElem.value);
            logger(`Платформа: IP изменен на: ${platformIpInputElem.value}`);
        }
    });

    platformHandbrakeButton.addEventListener('click', () => {
        if (platformControllerInstance) platformControllerInstance.toggleHandbrake();
    });


    // --- Общие обработчики клавиатуры ---
    const platformKeys = ['w', 'a', 's', 'd'];
    const platformActionKeys = [' ']; // Space for handbrake
    const cameraArrowKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const cameraZoomKeys = ['z', 'x'];

    document.addEventListener('keydown', (event) => {
        if (document.activeElement && ['input', 'select', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) {
            return; // Не обрабатывать, если фокус на инпуте
        }
        
        const key = event.key.toLowerCase();
        let handled = false;

        // Управление платформой
        if (platformKeys.includes(key) && platformControllerInstance) {
            platformControllerInstance.pressKey(key);
            handled = true;
        } else if (platformActionKeys.includes(key) && platformControllerInstance) {
            if (key === ' ') platformControllerInstance.toggleHandbrake(); // Toggle on keydown
            handled = true;
        }
        // Управление камерой
        else if (cameraArrowKeys.includes(key) || cameraZoomKeys.includes(key)) {
            if (!isCurrentlyMovingPtz) { // Только если не движется уже
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
        if (document.activeElement && ['input', 'select', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) {
            return; 
        }

        const key = event.key.toLowerCase();
        let handled = false;

        // Управление платформой
        if (platformKeys.includes(key) && platformControllerInstance) {
            platformControllerInstance.releaseKey(key);
            handled = true;
        }
        // Управление камерой
        else if (cameraArrowKeys.includes(key) || cameraZoomKeys.includes(key)) {
             if (isCurrentlyMovingPtz) {
                const control = ptzControlConfig.find(c => c.key === key);
                if (control) { // Проверяем, что это одна из клавиш, которая могла инициировать движение
                    stopCameraPtzMovement();
                    handled = true;
                }
            }
        }
        
        // if (handled) { // preventDefault на keyup обычно не нужен, но можно добавить при необходимости
        //     event.preventDefault();
        // }
    });

    logger("Полная инициализация интерфейса завершена.");
    hideLoader();
});