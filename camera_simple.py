import cv2
import requests
import time
import logging # Заменим на print или настроим базовый logging
import base64
import hashlib
import random # Заменили numpy.random
from datetime import datetime, timezone
from enum import Enum

# --- Начало Конфигурации ---
RTSP_URL = "rtsp://admin:123456@192.168.0.167:554"  # Замените на ваш URL
ONVIF_HOST = "192.168.0.167"  # IP-адрес камеры для ONVIF управления
ONVIF_USER = "admin"  # Имя пользователя для ONVIF
ONVIF_PASSWORD = "123456"  # Пароль для ONVIF (ВАЖНО: замените на ваш!)
# Возможные значения: "YOOSEE", "YCC365", "Y05"
SELECTED_CAMERA_TYPE_NAME = "YCC365"
PTZ_MOVE_TIME = 0.4  # Время движения камеры при одном нажатии клавиши (в секундах)
IS_INVERT_UPDOWN_PTZ = False # Инвертировать ли управление вверх/вниз

# Скорости движения (от -1.0 до 1.0)
PAN_SPEED = 0.5
TILT_SPEED = 0.5
ZOOM_SPEED = 0.5 # Для камер, поддерживающих управление скоростью зума через ContinuousMove
# --- Конец Конфигурации ---

# Настройка базового логирования (можно заменить на print)
# logging.basicConfig(level=logging.INFO)
# logger = logging.getLogger(__name__)
def logger_error(msg): print(f"ERROR: {msg}")
def logger_info(msg): print(f"INFO: {msg}")


class CameraType(Enum):
    YOOSEE = "YOOSEE"
    YCC365 = "YCC365"
    Y05 = "Y05"

try:
    SELECTED_CAMERA_TYPE = CameraType[SELECTED_CAMERA_TYPE_NAME]
except KeyError:
    logger_error(f"Неверный тип камеры: {SELECTED_CAMERA_TYPE_NAME}. Доступные: {', '.join([t.name for t in CameraType])}")
    exit()

# Константы из оригинального скрипта (адаптированные)
Y05_DEFAULT_PROFILE = "PROFILE_000"
Y05_DEFAULT_PRESET_TOKEN = "Preset1" # Пример
Y05_SERVICE_PATH = ":6688/onvif/ptz_service"

YOOSEE_DEFAULT_PROFILE = "IPCProfilesToken1"
YOOSEE_SERVICE_PATH = ":5000/onvif/deviceio_service" # В оригинале был deviceio_service, но для PTZ обычно ptz_service
# Проверьте правильный service path для PTZ вашей YOOSEE камеры. Часто это /onvif/ptz_service
# Если используется deviceio_service, команды могут отличаться.
# Для YOOSEE PTZ может быть тот же путь, что и для Y05, или другой порт.
# Для большей совместимости, PTZ обычно находится по /onvif/ptz_service или похожему.
# Предположим, что YOOSEE PTZ может быть на стандартном PTZ пути, если deviceio не работает для PTZ
# YOOSEE_PTZ_SERVICE_PATH = ":5000/onvif/ptz_service" # Пример альтернативного пути

YCC365_DEFAULT_PROFILE = "Profile_1"
YCC365_SERVICE_PATH = "/onvif/PTZ" # Для YCC365
YCC365_DEFAULT_HEADERS = {'Content-Type': 'application/soap+xml;charset=UTF8'}


# --- Функции для ONVIF PTZ управления (адаптированные) ---

def get_camera_onvif_params(camera_type_enum):
    """Возвращает профиль и путь сервиса для типа камеры"""
    if camera_type_enum == CameraType.Y05:
        return Y05_DEFAULT_PROFILE, Y05_SERVICE_PATH
    elif camera_type_enum == CameraType.YOOSEE:
        # Важно: убедитесь, что YOOSEE_SERVICE_PATH корректен для PTZ команд
        return YOOSEE_DEFAULT_PROFILE, YOOSEE_SERVICE_PATH # или YOOSEE_PTZ_SERVICE_PATH
    elif camera_type_enum == CameraType.YCC365:
        return YCC365_DEFAULT_PROFILE, YCC365_SERVICE_PATH
    return None, None

def generate_onvif_wssecurity_header(user, password):
    """Генерирует WS-Security SOAP Header с PasswordDigest"""
    creation_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z" # Формат с миллисекундами
    nonce_str = str(random.randint(100000000, 999999999)) # Более длинный nonce
    nonce_base64 = base64.b64encode(nonce_str.encode('utf-8')).decode('ascii')

    # Digest = Base64(SHA1(Nonce + Created + Password))
    # В оригинальном скрипте для YOOSEE использовался HEX дайджест (b16encode)
    # Это не стандартно для PasswordDigest, но если работало, то нужно его повторить.
    # Стандартный PasswordDigest это base64(sha1(nonce_bytes + created_bytes + password_bytes))
    
    # Для YOOSEE/Y05, если оригинальный скрипт работал с HEX (b16encode):
    # sha1_hash = hashlib.sha1(nonce_str.encode('utf-8') + creation_date.encode('utf-8') + password.encode('utf-8')).digest()
    # password_digest_final = base64.b16encode(sha1_hash).decode('ascii')
    
    # Используем стандартный PasswordDigest (Base64)
    # Для этого Nonce должен быть в виде байтов, не base64 строки, при вычислении хеша
    nonce_bytes = nonce_str.encode('utf-8') # Используем сам nonce_str, а не его base64 представление в хеше
    created_bytes = creation_date.encode('utf-8')
    password_bytes = password.encode('utf-8')
    
    sha1_hash = hashlib.sha1(nonce_bytes + created_bytes + password_bytes).digest()
    password_digest_final = base64.b64encode(sha1_hash).decode('ascii')


    security_header = f"""
    <s:Header>
        <Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
            <UsernameToken>
                <Username>{user}</Username>
                <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{password_digest_final}</Password>
                <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{nonce_base64}</Nonce>
                <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{creation_date}</Created>
            </UsernameToken>
        </Security>
    </s:Header>"""
    return security_header

def build_onvif_envelope(user, password, service_content, camera_type_enum_for_auth):
    """Собирает полный SOAP конверт"""
    header_part = ""
    # YOOSEE и Y05 используют WS-Security заголовок из оригинального скрипта
    if camera_type_enum_for_auth in [CameraType.YOOSEE, CameraType.Y05]:
        header_part = generate_onvif_wssecurity_header(user, password)

    return f"""<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    {header_part}
    <s:Body>
    {service_content}
    </s:Body>
</s:Envelope>"""

def ptz_stop_request(host, camera_type_enum, user, password):
    """Отправляет команду Stop"""
    profile_token, service_path_suffix = get_camera_onvif_params(camera_type_enum)
    if not profile_token:
        logger_error(f"Не удалось получить параметры для {camera_type_enum.name}")
        return

    service_url = f"http://{host}{service_path_suffix}"
    xml_payload = ""
    headers = {}

    if camera_type_enum in [CameraType.YOOSEE, CameraType.Y05]:
        service_content = f"""<Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">
                                <ProfileToken>{profile_token}</ProfileToken>
                                <PanTilt>true</PanTilt>
                                <Zoom>true</Zoom>
                            </Stop>"""
        xml_payload = build_onvif_envelope(user, password, service_content, camera_type_enum)
        action_url = "http://www.onvif.org/ver20/ptz/wsdl/Stop" # Предполагаемое действие
        headers = {'Content-Type': f'application/soap+xml;charset=UTF8;action="{action_url}"'}
    
    elif camera_type_enum == CameraType.YCC365:
        xml_payload = f"""<?xml version="1.0" encoding="utf-8"?>
                        <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
                            <soap:Body>
                                <tptz:Stop>
                                    <tptz:ProfileToken>{profile_token}</tptz:ProfileToken>
                                    <tptz:PanTilt>true</tptz:PanTilt>
                                    <tptz:Zoom>true</tptz:Zoom>
                                </tptz:Stop>
                            </soap:Body>
                        </soap:Envelope>"""
        headers = YCC365_DEFAULT_HEADERS
        service_url = f"http://{host}{YCC365_SERVICE_PATH}" # У YCC365 свой service_url

    if xml_payload:
        try:
            logger_info(f"STOP Request to {service_url} for {camera_type_enum.name}")
            # logger_info(f"Payload: {xml_payload}") # Для отладки
            r = requests.post(service_url, data=xml_payload, headers=headers, timeout=2)
            logger_info(f"STOP Response: {r.status_code}")
            if r.status_code != 200 and r.status_code != 204 : # Некоторые камеры отвечают 204 No Content
                 logger_error(f"PTZ Stop Ошибка: {r.status_code} - {r.text}")
        except requests.exceptions.RequestException as e:
            logger_error(f"PTZ Stop Исключение: {e}")

def ptz_continuous_move_request(host, camera_type_enum, user, password, x, y, z):
    """Отправляет команду ContinuousMove"""
    profile_token, service_path_suffix = get_camera_onvif_params(camera_type_enum)
    if not profile_token:
        logger_error(f"Не удалось получить параметры для {camera_type_enum.name}")
        return

    service_url = f"http://{host}{service_path_suffix}"
    xml_payload = ""
    headers = {}

    if camera_type_enum in [CameraType.YOOSEE, CameraType.Y05]:
        # Убедимся, что пространство имен для PanTilt и Zoom соответствует схеме ONVIF ver10
        service_content = f"""<ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
                                <ProfileToken>{profile_token}</ProfileToken>
                                <Velocity>
                                    <PanTilt x="{x}" y="{y}" space="http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocityGenericSpace" xmlns="http://www.onvif.org/ver10/schema"/>
                                    <Zoom x="{z}" space="http://www.onvif.org/ver10/tptz/ZoomSpaces/VelocityGenericSpace" xmlns="http://www.onvif.org/ver10/schema"/>
                                </Velocity>
                            </ContinuousMove>"""
        xml_payload = build_onvif_envelope(user, password, service_content, camera_type_enum)
        action_url = "http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove" # Предполагаемое действие
        headers = {'Content-Type': f'application/soap+xml;charset=UTF8;action="{action_url}"'}

    elif camera_type_enum == CameraType.YCC365:
        xml_payload = f"""<?xml version="1.0" encoding="utf-8"?>
                        <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                            <soap:Body>
                                <tptz:ContinuousMove>
                                    <tptz:ProfileToken>{profile_token}</tptz:ProfileToken>
                                    <tptz:Velocity>
                                        <tt:PanTilt x="{x}" y="{y}"/>
                                        <tt:Zoom x="{z}"/>
                                    </tptz:Velocity>
                                </tptz:ContinuousMove>
                            </soap:Body>
                        </soap:Envelope>"""
        headers = YCC365_DEFAULT_HEADERS
        service_url = f"http://{host}{YCC365_SERVICE_PATH}"


    if xml_payload:
        try:
            logger_info(f"MOVE Request ({x},{y},{z}) to {service_url} for {camera_type_enum.name}")
            # logger_info(f"Payload: {xml_payload}") # Для отладки
            r = requests.post(service_url, data=xml_payload.encode('utf-8'), headers=headers, timeout=2) # encode to utf-8
            logger_info(f"MOVE Response: {r.status_code}")
            if r.status_code != 200:
                 logger_error(f"PTZ Move Ошибка: {r.status_code} - {r.text}")
        except requests.exceptions.RequestException as e:
            logger_error(f"PTZ Move Исключение: {e}")

# --- Основное приложение с OpenCV ---
if __name__ == "__main__":
    logger_info(f"Подключение к RTSP потоку: {RTSP_URL}")
    cap = cv2.VideoCapture(RTSP_URL)

    if not cap.isOpened():
        logger_error(f"Ошибка: Не удалось подключиться к RTSP потоку по адресу: {RTSP_URL}")
        exit()

    logger_info("RTSP поток открыт. Управление камерой:")
    logger_info("  w: Вверх, s: Вниз, a: Влево, d: Вправо")
    logger_info("  z: Zoom In (приблизить), x: Zoom Out (отдалить)")
    logger_info("  Пробел: Стоп")
    logger_info("  q: Выход")

    window_name = 'RTSP Stream with PTZ Control'
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    last_move_time = 0
    is_moving = False

    while True:
        ret, frame = cap.read()
        if not ret:
            logger_error("Ошибка: Не удалось получить кадр. Поток завершен или потерян.")
            break

        cv2.imshow(window_name, frame)
        key = cv2.waitKey(1) & 0xFF # Ожидание 1мс для плавности видео

        current_time = time.time()
        
        # Автоматическая остановка движения через PTZ_MOVE_TIME
        if is_moving and (current_time - last_move_time > PTZ_MOVE_TIME):
            logger_info("Auto-stopping PTZ movement.")
            ptz_stop_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD)
            is_moving = False

        if key == ord('q'):
            if is_moving: # Остановить движение перед выходом
                 ptz_stop_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD)
            logger_info("Выход...")
            break
        
        # Команды движения
        # Движение вверх/вниз инвертируется если IS_INVERT_UPDOWN_PTZ = True
        y_up = -TILT_SPEED if IS_INVERT_UPDOWN_PTZ else TILT_SPEED
        y_down = TILT_SPEED if IS_INVERT_UPDOWN_PTZ else -TILT_SPEED

        if key == ord('w'): # Вверх
            ptz_continuous_move_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD, 0, y_up, 0)
            last_move_time = current_time
            is_moving = True
        elif key == ord('s'): # Вниз
            ptz_continuous_move_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD, 0, y_down, 0)
            last_move_time = current_time
            is_moving = True
        elif key == ord('a'): # Влево
            ptz_continuous_move_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD, -PAN_SPEED, 0, 0)
            last_move_time = current_time
            is_moving = True
        elif key == ord('d'): # Вправо
            ptz_continuous_move_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD, PAN_SPEED, 0, 0)
            last_move_time = current_time
            is_moving = True
        elif key == ord('z'): # Zoom In
            ptz_continuous_move_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD, 0, 0, ZOOM_SPEED)
            last_move_time = current_time
            is_moving = True
        elif key == ord('x'): # Zoom Out
            ptz_continuous_move_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD, 0, 0, -ZOOM_SPEED)
            last_move_time = current_time
            is_moving = True
        elif key == ord(' '): # Стоп
            ptz_stop_request(ONVIF_HOST, SELECTED_CAMERA_TYPE, ONVIF_USER, ONVIF_PASSWORD)
            is_moving = False
        # Добавьте другие команды, например, для пресетов или домашней позиции, если нужно

    cap.release()
    cv2.destroyAllWindows()
    logger_info("Программа завершена.")