// main.js

// --- Глобальные/модульные переменные для DOM элементов ---
let logOutputElement = null;
let loaderElement = null;
let videoStreamImgElement = null;

// --- Конфигурационные переменные (будут заполняться из HTML) ---
let ONVIF_HOST_CONFIG;
let ONVIF_USER_CONFIG;
let ONVIF_PASSWORD_CONFIG;
let RTSP_URL_CONFIG;
let SELECTED_CAMERA_TYPE_NAME_CONFIG;
let IS_INVERT_UPDOWN_PTZ_CONFIG;

// --- Константы PTZ ---
const PTZ_MOVE_TIME_MS = 0.4 * 1000; // Время движения в миллисекундах
const PAN_SPEED_CONFIG = 0.5;
const TILT_SPEED_CONFIG = 0.5;
const ZOOM_SPEED_CONFIG = 0.5;

// --- URL Бэкенда ---
const BACKEND_BASE_URL = 'http://localhost:5000'; // Замените, если ваш бэкенд на другом адресе/порту

// --- Функции Логирования и UI ---
function logger(message, type = 'info') {
    if (!logOutputElement) {
        console[type === 'error' ? 'error' : 'log'](`(Log element not ready) ${type.toUpperCase()}: ${message}`);
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
    if (loaderElement) {
        loaderElement.style.display = 'block';
    } else {
        console.warn("Элемент индикатора загрузки 'loader' не найден. Не могу показать.");
    }
}

function hideLoader() {
    if (loaderElement) {
        loaderElement.style.display = 'none';
    } else {
        console.warn("Элемент индикатора загрузки 'loader' не найден. Не могу скрыть.");
    }
}

// --- Функции для ONVIF PTZ управления ---
const CAMERA_PARAMS_CONFIG = {
    YOOSEE: { profile: "IPCProfilesToken1", servicePath: ":5000/onvif/ptz_service" },
    YCC365: { profile: "Profile_1", servicePath: "/onvif/PTZ" },
    Y05:    { profile: "PROFILE_000", servicePath: ":6688/onvif/ptz_service" }
};

function getCameraOnvifParamsDetail(cameraType) {
    return CAMERA_PARAMS_CONFIG[cameraType] || null;
}

function generateNonceForOnvif(length = 24) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function generateOnvifWsSecurityHeaderJS(user, password) {
    const createdDate = new Date().toISOString();
    const nonceStr = generateNonceForOnvif();
    const nonceBase64 = btoa(nonceStr);

    const encoder = new TextEncoder();
    const nonceBytes = encoder.encode(nonceStr);
    const createdBytes = encoder.encode(createdDate);
    const passwordBytes = encoder.encode(password);

    const combinedData = new Uint8Array(nonceBytes.length + createdBytes.length + passwordBytes.length);
    combinedData.set(nonceBytes, 0);
    combinedData.set(createdBytes, nonceBytes.length);
    combinedData.set(passwordBytes, nonceBytes.length + createdBytes.length);
    
    const hashBuffer = await crypto.subtle.digest('SHA-1', combinedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordDigest = btoa(String.fromCharCode(...hashArray));

    return `
    <s:Header>
        <Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
            <UsernameToken>
                <Username>${user}</Username>
                <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</Password>
                <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceBase64}</Nonce>
                <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${createdDate}</Created>
            </UsernameToken>
        </Security>
    </s:Header>`;
}

// Эта функция больше не нужна на фронтенде, т.к. бэкенд строит SOAP.
// Оставлена для справки, если бы логика была другой.
/*
async function buildOnvifEnvelopeJS(user, password, serviceContent, cameraType) {
    // ...
}
*/

async function sendOnvifRequestToBackend(ptzAction, panSpeed = 0, tiltSpeed = 0, zoomSpeed = 0) {
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

    logger(`Отправка PTZ команды: ${ptzAction} на ${requestUrl}`);
    
    try {
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responseData = await response.json();

        if (response.ok && responseData.status === 'success') {
            logger(`PTZ ${ptzAction} успешно: ${responseData.message}`, 'success');
        } else {
            const errorMsg = responseData.message || `HTTP ${response.status}`;
            logger(`Ошибка PTZ ${ptzAction}: ${errorMsg}. Детали: ${responseData.details || ''}`, 'error');
        }
    } catch (e) {
        logger(`Исключение при PTZ ${ptzAction}: ${e.message}`, 'error');
    } finally {
        hideLoader();
    }
}

async function ptzStopRequestCommand() {
    await sendOnvifRequestToBackend('stop');
}

async function ptzContinuousMoveRequestCommand(x, y, z) {
    await sendOnvifRequestToBackend('move', x, y, z);
}

// --- Управление состоянием движения PTZ и авто-остановка ---
let ptzMoveTimeoutId = null;
let isCurrentlyMovingPtz = false;

function startPtzMovement(x, y, z) {
    if (ptzMoveTimeoutId) clearTimeout(ptzMoveTimeoutId);
    isCurrentlyMovingPtz = true;
    ptzContinuousMoveRequestCommand(x, y, z);
    ptzMoveTimeoutId = setTimeout(() => {
        if (isCurrentlyMovingPtz) {
            logger("Авто-остановка PTZ движения.");
            ptzStopRequestCommand(); // Используем команду для бэкенда
            isCurrentlyMovingPtz = false;
        }
    }, PTZ_MOVE_TIME_MS);
}

function stopPtzMovement() {
    if (ptzMoveTimeoutId) clearTimeout(ptzMoveTimeoutId);
    if (isCurrentlyMovingPtz) {
        ptzStopRequestCommand(); // Используем команду для бэкенда
        isCurrentlyMovingPtz = false;
    }
}

// --- Обновление конфигурации из HTML ---
function updateAllConfigValues() {
    ONVIF_HOST_CONFIG = document.getElementById('cameraIp').value;
    ONVIF_USER_CONFIG = document.getElementById('onvifUser').value;
    ONVIF_PASSWORD_CONFIG = document.getElementById('onvifPassword').value;
    RTSP_URL_CONFIG = document.getElementById('rtspUrl').value;
    SELECTED_CAMERA_TYPE_NAME_CONFIG = document.getElementById('cameraType').value;
    IS_INVERT_UPDOWN_PTZ_CONFIG = document.getElementById('invertUpDown').checked;
    logger("Конфигурация обновлена из HTML полей.");
}

// --- Инициализация и обработчики событий ---
document.addEventListener('DOMContentLoaded', () => {
    // Инициализация DOM элементов
    logOutputElement = document.getElementById('logOutput');
    loaderElement = document.getElementById('loader');
    videoStreamImgElement = document.getElementById('videoStream');

    // Проверки на наличие критически важных элементов
    if (!logOutputElement) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: HTML-элемент с ID 'logOutput' не найден!");
        alert("Ошибка: элемент для вывода логов не найден.");
    }
    if (!loaderElement) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: HTML-элемент с ID 'loader' не найден!");
        alert("Ошибка: элемент индикатора загрузки не найден.");
    }
    if (!videoStreamImgElement) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА: HTML-элемент с ID 'videoStream' не найден!");
        alert("Ошибка: элемент для отображения видео не найден.");
    }

    updateAllConfigValues(); // Первоначальное считывание конфига

    // Обновление конфига при изменении полей
    ['cameraIp', 'onvifUser', 'onvifPassword', 'rtspUrl', 'cameraType', 'invertUpDown'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', updateAllConfigValues);
        }
    });
    
    // --- Обработчики для кнопок PTZ ---
    const ptzControlConfig = [
        { id: 'ptzUp',    x: 0, y: () => IS_INVERT_UPDOWN_PTZ_CONFIG ? -TILT_SPEED_CONFIG : TILT_SPEED_CONFIG, z: 0, key: 'w' },
        { id: 'ptzDown',  x: 0, y: () => IS_INVERT_UPDOWN_PTZ_CONFIG ? TILT_SPEED_CONFIG : -TILT_SPEED_CONFIG, z: 0, key: 's' },
        { id: 'ptzLeft',  x: -PAN_SPEED_CONFIG, y: 0, z: 0, key: 'a' },
        { id: 'ptzRight', x: PAN_SPEED_CONFIG,  y: 0, z: 0, key: 'd' },
        { id: 'ptzZoomIn',x: 0, y: 0, z: ZOOM_SPEED_CONFIG, key: 'z' },
        { id: 'ptzZoomOut',x:0, y: 0, z: -ZOOM_SPEED_CONFIG,key: 'x' }
    ];

    ptzControlConfig.forEach(ctrl => {
        const button = document.getElementById(ctrl.id);
        if (button) {
            const action = () => startPtzMovement(ctrl.x, typeof ctrl.y === 'function' ? ctrl.y() : ctrl.y, ctrl.z);
            button.addEventListener('mousedown', action);
            button.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, { passive: false });
            
            button.addEventListener('mouseup', stopPtzMovement);
            button.addEventListener('mouseleave', stopPtzMovement);
            button.addEventListener('touchend', stopPtzMovement);
            button.addEventListener('touchcancel', stopPtzMovement);
        } else {
            logger(`Кнопка PTZ с ID '${ctrl.id}' не найдена.`, 'error');
        }
    });

    const stopButton = document.getElementById('ptzStop');
    if (stopButton) {
        stopButton.addEventListener('click', stopPtzMovement);
    } else {
        logger("Кнопка 'ptzStop' не найдена.", 'error');
    }

    // --- Горячие клавиши ---
    document.addEventListener('keydown', (event) => {
        if (document.activeElement && ['input', 'select', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) {
            return; // Не обрабатывать, если фокус на инпуте
        }
        const control = ptzControlConfig.find(c => c.key === event.key.toLowerCase());
        if (control && !isCurrentlyMovingPtz) {
            event.preventDefault();
            startPtzMovement(control.x, typeof control.y === 'function' ? control.y() : control.y, control.z);
        } else if (event.key === ' ' || event.code === 'Space') {
            event.preventDefault();
            stopPtzMovement();
        }
    });
    document.addEventListener('keyup', (event) => {
        if (document.activeElement && ['input', 'select', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) {
            return; 
        }
        const control = ptzControlConfig.find(c => c.key === event.key.toLowerCase());
        if (control && isCurrentlyMovingPtz) {
            event.preventDefault();
            stopPtzMovement();
        }
    });

    // --- Кнопка запуска/обновления видеопотока ---
    const startStreamButton = document.getElementById('startStreamButton');
    if (startStreamButton && videoStreamImgElement) {
        startStreamButton.addEventListener('click', () => {
            const currentRtspUrl = document.getElementById('rtspUrl').value;
            if (!currentRtspUrl) {
                logger("RTSP URL не указан.", "error");
                alert("Пожалуйста, введите RTSP URL для видеопотока.");
                return;
            }
            const mjpegStreamUrl = `${BACKEND_BASE_URL}/api/video-stream?rtsp=${encodeURIComponent(currentRtspUrl)}`; 
            logger(`Попытка загрузить видео с: ${mjpegStreamUrl}`);
            videoStreamImgElement.src = mjpegStreamUrl;
            videoStreamImgElement.onerror = () => {
                logger("Ошибка загрузки видеопотока. Убедитесь, что бэкенд настроен, камера доступна и RTSP URL корректен.", "error");
                videoStreamImgElement.src = "https://placehold.co/640x360/000000/FFFFFF?text=Ошибка+загрузки+видео%0A(проверьте+URL+и+бэкенд)";
            };
            videoStreamImgElement.onload = () => {
                 logger("Видеопоток успешно загружен (или начата загрузка).", "success");
            };
        });
    } else {
        logger("Кнопка 'startStreamButton' или элемент 'videoStream' не найдены.", 'error');
    }

    logger("Интерфейс инициализирован. DOM загружен.");
    hideLoader(); // Убедимся, что лоадер скрыт при начальной загрузке
});