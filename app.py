from flask import Flask, Response, request, jsonify, render_template # Добавлен render_template
from flask_cors import CORS
import cv2
import requests
import time
import base64
import hashlib
import random
from datetime import datetime, timezone
from enum import Enum
import threading # Для фонового захвата видео

# --- Начало Конфигурации (может быть переопределено запросами) ---
DEFAULT_RTSP_URL = "rtsp://admin:123456@192.168.0.167:554"
# --- Конец Конфигурации ---

app = Flask(__name__) # Flask автоматически ищет 'static' и 'templates' в той же директории
CORS(app) 

# --- Логирование ---
def logger_error(msg): print(f"ERROR: {msg}")
def logger_info(msg): print(f"INFO: {msg}")

# --- Код ONVIF из оригинального скрипта ---
class CameraType(Enum):
    YOOSEE = "YOOSEE"
    YCC365 = "YCC365"
    Y05 = "Y05"

# Константы для ONVIF
Y05_DEFAULT_PROFILE = "PROFILE_000"
Y05_SERVICE_PATH = ":6688/onvif/ptz_service"

YOOSEE_DEFAULT_PROFILE = "IPCProfilesToken1"
YOOSEE_SERVICE_PATH = ":5000/onvif/ptz_service" 

YCC365_DEFAULT_PROFILE = "Profile_1"
YCC365_SERVICE_PATH = "/onvif/PTZ"
YCC365_DEFAULT_HEADERS = {'Content-Type': 'application/soap+xml;charset=UTF8'}


def get_camera_onvif_params(camera_type_enum_str):
    try:
        camera_type_enum = CameraType[camera_type_enum_str.upper()]
    except KeyError:
        logger_error(f"Неверный тип камеры: {camera_type_enum_str}")
        return None, None

    if camera_type_enum == CameraType.Y05:
        return Y05_DEFAULT_PROFILE, Y05_SERVICE_PATH
    elif camera_type_enum == CameraType.YOOSEE:
        return YOOSEE_DEFAULT_PROFILE, YOOSEE_SERVICE_PATH
    elif camera_type_enum == CameraType.YCC365:
        return YCC365_DEFAULT_PROFILE, YCC365_SERVICE_PATH
    return None, None

def generate_onvif_wssecurity_header(user, password):
    creation_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    nonce_str = ''.join(random.choices("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=24))
    nonce_base64 = base64.b64encode(nonce_str.encode('utf-8')).decode('ascii')
    
    nonce_bytes = nonce_str.encode('utf-8')
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

def build_onvif_envelope(user, password, service_content, camera_type_enum_str):
    header_part = ""
    if camera_type_enum_str.upper() in [CameraType.YOOSEE.name, CameraType.Y05.name]:
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

def send_ptz_request(host, camera_type_str, user, password, service_content_builder, ptz_action_name, x=0, y=0, z=0):
    profile_token, service_path_suffix = get_camera_onvif_params(camera_type_str)
    if not profile_token:
        msg = f"Не удалось получить параметры для {camera_type_str}"
        logger_error(msg)
        return jsonify({"status": "error", "message": msg}), 500

    service_url = f"http://{host}{service_path_suffix}"
    xml_payload = ""
    headers = {}
    
    service_content = service_content_builder(profile_token, x, y, z)

    if camera_type_str.upper() in [CameraType.YOOSEE.name, CameraType.Y05.name]:
        xml_payload = build_onvif_envelope(user, password, service_content, camera_type_str)
        onvif_action = "Stop" if ptz_action_name == "Stop" else "ContinuousMove"
        action_url = f"http://www.onvif.org/ver20/ptz/wsdl/{onvif_action}"
        headers = {'Content-Type': f'application/soap+xml;charset=UTF8;action="{action_url}"'}
    
    elif camera_type_str.upper() == CameraType.YCC365.name:
        xml_payload = f"""<?xml version="1.0" encoding="utf-8"?>
                        <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
                            <soap:Body>
                            {service_content}
                            </soap:Body>
                        </soap:Envelope>"""
        headers = YCC365_DEFAULT_HEADERS

    if xml_payload:
        try:
            logger_info(f"{ptz_action_name} Request to {service_url} for {camera_type_str}")
            r = requests.post(service_url, data=xml_payload.encode('utf-8'), headers=headers, timeout=3)
            logger_info(f"{ptz_action_name} Response: {r.status_code}")
            
            if r.status_code not in [200, 202, 204]:
                logger_error(f"PTZ {ptz_action_name} Ошибка: {r.status_code} - {r.text}")
                return jsonify({"status": "error", "message": f"PTZ {ptz_action_name} Ошибка: {r.status_code}", "details": r.text}), r.status_code
            return jsonify({"status": "success", "message": f"PTZ {ptz_action_name} выполнен: {r.status_code}", "response_text": r.text}), r.status_code
        except requests.exceptions.RequestException as e:
            logger_error(f"PTZ {ptz_action_name} Исключение: {e}")
            return jsonify({"status": "error", "message": f"PTZ {ptz_action_name} Исключение: {str(e)}"}), 500
    else:
        return jsonify({"status": "error", "message": "Не удалось сформировать XML payload"}), 500

SELECTED_CAMERA_TYPE_NAME_GLOBAL = CameraType.YCC365.name 

def build_stop_content(profile_token, x, y, z):
    if SELECTED_CAMERA_TYPE_NAME_GLOBAL.upper() in [CameraType.YOOSEE.name, CameraType.Y05.name]:
        return f"""<Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">
                    <ProfileToken>{profile_token}</ProfileToken>
                    <PanTilt>true</PanTilt>
                    <Zoom>true</Zoom>
                </Stop>"""
    elif SELECTED_CAMERA_TYPE_NAME_GLOBAL.upper() == CameraType.YCC365.name:
         return f"""<tptz:Stop>
                    <tptz:ProfileToken>{profile_token}</tptz:ProfileToken>
                    <tptz:PanTilt>true</tptz:PanTilt>
                    <tptz:Zoom>true</tptz:Zoom>
                </tptz:Stop>"""
    return ""

def build_continuous_move_content(profile_token, x_speed, y_speed, z_speed):
    if SELECTED_CAMERA_TYPE_NAME_GLOBAL.upper() in [CameraType.YOOSEE.name, CameraType.Y05.name]:
        return f"""<ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
                    <ProfileToken>{profile_token}</ProfileToken>
                    <Velocity>
                        <PanTilt x="{x_speed}" y="{y_speed}" space="http://www.onvif.org/ver10/tptz/PanTiltSpaces/VelocityGenericSpace" xmlns="http://www.onvif.org/ver10/schema"/>
                        <Zoom x="{z_speed}" space="http://www.onvif.org/ver10/tptz/ZoomSpaces/VelocityGenericSpace" xmlns="http://www.onvif.org/ver10/schema"/>
                    </Velocity>
                </ContinuousMove>"""
    elif SELECTED_CAMERA_TYPE_NAME_GLOBAL.upper() == CameraType.YCC365.name:
        return f"""<tptz:ContinuousMove>
                    <tptz:ProfileToken>{profile_token}</tptz:ProfileToken>
                    <tptz:Velocity>
                        <tt:PanTilt x="{x_speed}" y="{y_speed}"/>
                        <tt:Zoom x="{z_speed}"/>
                    </tptz:Velocity>
                </tptz:ContinuousMove>"""
    return ""

# --- Маршруты Flask ---

# Маршрут для главной HTML страницы
@app.route('/')
def index():
    logger_info("Запрос главной страницы index.html")
    return render_template('index.html')

@app.route('/api/ptz', methods=['POST'])
def ptz_control():
    global SELECTED_CAMERA_TYPE_NAME_GLOBAL
    data = request.json
    logger_info(f"Получен PTZ запрос: {data}")

    camera_ip = data.get('camera_ip')
    onvif_user = data.get('onvif_user')
    onvif_password = data.get('onvif_password')
    camera_type = data.get('camera_type')
    action = data.get('action') 

    if not all([camera_ip, onvif_user, onvif_password, camera_type, action]):
        return jsonify({"status": "error", "message": "Отсутствуют обязательные параметры"}), 400
    
    SELECTED_CAMERA_TYPE_NAME_GLOBAL = camera_type 

    if action == 'move':
        pan = data.get('pan', 0.0)
        tilt = data.get('tilt', 0.0)
        zoom = data.get('zoom', 0.0)
        return send_ptz_request(camera_ip, camera_type, onvif_user, onvif_password, 
                                build_continuous_move_content, "ContinuousMove",
                                x=pan, y=tilt, z=zoom)
    elif action == 'stop':
        return send_ptz_request(camera_ip, camera_type, onvif_user, onvif_password,
                                build_stop_content, "Stop")
    else:
        return jsonify({"status": "error", "message": "Неизвестное действие"}), 400

video_capture = None
video_thread = None
rtsp_url_global = DEFAULT_RTSP_URL 

def capture_frames():
    global video_capture, rtsp_url_global
    
    # Локальная копия URL для этого потока, чтобы избежать гонок при смене URL
    current_capture_rtsp_url = rtsp_url_global 
    logger_info(f"Поток захвата: Попытка подключения к RTSP: {current_capture_rtsp_url}")
    
    # Создаем новый объект VideoCapture для этого потока
    # Не используем глобальный video_capture напрямую для инициализации здесь,
    # чтобы каждый поток работал со своим экземпляром, если это необходимо.
    # Однако, для MJPEG стриминга обычно один источник на один URL.
    cap = cv2.VideoCapture(current_capture_rtsp_url)

    if not cap.isOpened():
        logger_error(f"Поток захвата: Ошибка подключения к RTSP: {current_capture_rtsp_url}")
        cap.release()
        return 

    logger_info(f"Поток захвата: RTSP поток успешно открыт для {current_capture_rtsp_url}")
    
    while True:
        # Проверяем, не изменился ли глобальный URL, и если да, то этот поток должен завершиться
        # чтобы новый поток мог быть запущен для нового URL.
        if rtsp_url_global != current_capture_rtsp_url:
            logger_info(f"Поток захвата: URL RTSP изменился с {current_capture_rtsp_url} на {rtsp_url_global}. Завершение текущего потока.")
            break

        if cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                logger_error(f"Поток захвата: Ошибка получения кадра с {current_capture_rtsp_url}. Поток завершен или потерян.")
                # Попытка переподключения не очень хорошо работает в долгосрочной перспективе внутри yield-генератора
                # Лучше, чтобы video_feed перезапустил поток.
                break 

            (flag, encodedImage) = cv2.imencode(".jpg", frame)
            if not flag:
                continue
            yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + 
                   bytearray(encodedImage) + b'\r\n')
        else:
            logger_info(f"Поток захвата: Видеопоток {current_capture_rtsp_url} не активен, завершение.")
            break
    
    logger_info(f"Поток захвата: Освобождение ресурсов для {current_capture_rtsp_url}")
    cap.release()


@app.route('/api/video-stream')
def video_feed():
    global rtsp_url_global, video_thread # video_capture больше не управляется здесь напрямую

    req_rtsp_url = request.args.get('rtsp', DEFAULT_RTSP_URL)
    
    # Если URL изменился или поток не запущен/завершился, перезапускаем
    # Важно проверять is_alive(), так как поток мог завершиться сам (например, из-за ошибки)
    if req_rtsp_url != rtsp_url_global or video_thread is None or not video_thread.is_alive():
        logger_info(f"Видеоподача: URL RTSP изменен на: {req_rtsp_url} или поток не активен. Перезапуск.")
        
        # Если старый поток еще жив (например, URL изменился, а старый поток еще не заметил),
        # мы просто меняем rtsp_url_global. Старый поток увидит это изменение и завершится.
        rtsp_url_global = req_rtsp_url
        
        # Создаем и запускаем новый поток
        logger_info("Видеоподача: Запуск нового потока захвата видео...")
        video_thread = threading.Thread(target=capture_frames)
        video_thread.daemon = True 
        video_thread.start()
        
        # Даем небольшую паузу, чтобы поток успел запуститься и, возможно, выдать первый кадр
        # или ошибку подключения. Это не идеальное решение, но может помочь избежать
        # отправки пустого Response, если подключение занимает время.
        time.sleep(0.5) 
    else:
        logger_info("Видеоподача: Используется существующий активный поток захвата видео.")

    # Возвращаем MJPEG поток из функции capture_frames (которая теперь является генератором)
    # capture_frames будет выполняться в контексте video_thread
    # Response будет вызывать этот генератор для получения кадров
    return Response(capture_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')


if __name__ == '__main__':
    logger_info("Запуск Flask сервера для ONVIF PTZ управления и видеопотока...")
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True, use_reloader=False)

