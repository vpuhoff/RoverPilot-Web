import base64
from datetime import datetime, timezone
import hashlib
from random import random
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS # type: ignore
import cv2 # type: ignore
import asyncio
import uuid
import threading
import logging # Используем стандартный logging
from aiortc import RTCIceCandidate, RTCPeerConnection, RTCSessionDescription # type: ignore
from aiortc.contrib.media import MediaPlayer, MediaRelay # type: ignore
from enum import Enum

import requests

# --- Настройка логирования ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
def logger_error(msg): print(f"ERROR: {msg}")
def logger_info(msg): print(f"INFO: {msg}")

# --- Глобальные переменные ---
app = Flask(__name__)
CORS(app)

# ---  ONVIF  ---
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


pcs = set() # Хранилище для RTCPeerConnection объектов
# RTSP URL можно будет передавать через запрос или конфигурацию
DEFAULT_RTSP_URL = "rtsp://admin:123456@192.168.0.167:554" # Замените на ваш URL
media_relay = MediaRelay()
rtsp_video_track_source = None # Источник трека от MediaPlayer для ретрансляции

# Глобальный asyncio loop для фоновых задач WebRTC и RTSP
background_loop = None
rtsp_thread = None

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

# --- WebRTC Функции ---
async def create_rtsp_track_source(relay, rtsp_url):
    """
    Подключается к RTSP и возвращает источник трека для ретрансляции.
    Этот источник затем используется для создания индивидуальных треков для каждого WebRTC клиента.
    """
    logger.info(f"Попытка подключения к RTSP: {rtsp_url}")
    # Опции могут понадобиться для некоторых RTSP серверов
    options = {'rtsp_transport': 'tcp', 'stimeout': '5000000'} # 5 секунд таймаут
    player = MediaPlayer(rtsp_url, format='rtsp', options=options)
    
    if player.video:
        logger.info(f"RTSP видео трек получен: {player.video}")
        # Мы не подписываемся здесь, MediaRelay сделает это сам, когда первый клиент подключится
        # к треку, который мы получим из этого player.video через relay.subscribe()
        # Либо мы можем подписаться один раз и ретранслировать этот "ретранслированный трек".
        # MediaRelay.subscribe() возвращает новый трек, который ретранслирует оригинальный.
        return relay.subscribe(player.video)
    else:
        logger.error("Не удалось получить видео трек из RTSP плеера.")
        return None

def run_background_async_tasks():
    """Функция для выполнения в отдельном потоке, управляющая asyncio loop."""
    global background_loop, rtsp_video_track_source
    
    background_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(background_loop)
    
    try:
        logger.info("Фоновый asyncio loop запущен.")
        # Инициализация RTSP трека
        # Передаем rtsp_video_track_source как результат выполнения короутины
        rtsp_video_track_source = background_loop.run_until_complete(
            create_rtsp_track_source(media_relay, DEFAULT_RTSP_URL)
        )
        if not rtsp_video_track_source:
            logger.error("RTSP источник трека не был инициализирован. Видео не будет доступно.")
        else:
            logger.info("RTSP источник трека успешно инициализирован.")
        
        # Держим цикл активным для других потенциальных задач (например, WebSocket сигнализация)
        background_loop.run_forever()
    except Exception as e:
        logger.error(f"Ошибка в фоновом asyncio loop: {e}", exc_info=True)
    finally:
        if background_loop.is_running():
            background_loop.call_soon_threadsafe(background_loop.stop)
        logger.info("Фоновый asyncio loop остановлен.")

async def offer_async_logic(params):
    """Асинхронная логика для обработки offer."""
    global rtsp_video_track_source
    offer_sdp = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pc_id = "PeerConnection(%s)" % uuid.uuid4()
    pcs.add(pc)
    logger.info(f"{pc_id}: создан для оффера от клиента")

    @pc.on("icecandidate")
    async def on_icecandidate(candidate):
        # В реальном приложении здесь будет отправка кандидата клиенту через WebSocket
        if candidate:
            logger.info(f"{pc_id}: ICE candidate {candidate} -> нужно отправить клиенту")
        # Если candidate is None, это означает, что сбор кандидатов завершен.

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        logger.info(f"{pc_id}: ICE connection state is {pc.iceConnectionState}")
        if pc.iceConnectionState == "failed" or \
           pc.iceConnectionState == "disconnected" or \
           pc.iceConnectionState == "closed":
            await pc.close()
            pcs.discard(pc)
            logger.info(f"{pc_id}: закрыт из-за состояния ICE {pc.iceConnectionState}")

    # Добавляем видео трек от RTSP (если он инициализирован)
    if rtsp_video_track_source:
        logger.info(f"{pc_id}: Попытка добавить RTSP видео трек: {rtsp_video_track_source}")
        pc.addTrack(rtsp_video_track_source)
    else:
        logger.warning(f"{pc_id}: RTSP видео трек НЕ доступен при создании PeerConnection!")
        # Здесь можно предпринять действия, например, не добавлять трек или вернуть ошибку

    await pc.setRemoteDescription(offer_sdp)
    logger.info(f"{pc_id}: Remote description (offer) установлен")

    answer_sdp = await pc.createAnswer()
    await pc.setLocalDescription(answer_sdp)
    logger.info(f"{pc_id}: Local description (answer) создан и установлен")

    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}

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

# --- Flask эндпоинты ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/offer', methods=['POST'])
def offer_route():
    """Синхронный Flask-роут, который вызывает асинхронную WebRTC логику."""
    if not background_loop or not background_loop.is_running():
        logger.error("Фоновый asyncio loop не запущен. Невозможно обработать offer.")
        return jsonify({"error": "Server not ready"}), 500

    params = request.json # Flask's sync request parsing
    
    # Запускаем асинхронную логику в фоновом цикле и ждем результат
    # asyncio.run_coroutine_threadsafe возвращает future
    future = asyncio.run_coroutine_threadsafe(offer_async_logic(params), background_loop)
    try:
        result = future.result(timeout=10) # Ждем результат не более 10 секунд
        return jsonify(result)
    except asyncio.TimeoutError:
        logger.error("Таймаут при обработке offer в фоновом потоке.")
        return jsonify({"error": "Processing timeout"}), 500
    except Exception as e:
        logger.error(f"Ошибка при выполнении offer_async_logic: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# Код для управления камерой (ONVIF PTZ) остается здесь
@app.route('/api/ptz', methods=['POST'])
def ptz_control():
    global SELECTED_CAMERA_TYPE_NAME_GLOBAL
    data = request.json
    logger_info(f"Получен PTZ запрос: {data}")

    camera_ip = data.get('camera_ip') # type: ignore
    onvif_user = data.get('onvif_user') # type: ignore
    onvif_password = data.get('onvif_password') # type: ignore
    camera_type = data.get('camera_type') # type: ignore
    action = data.get('action')  # type: ignore

    if not all([camera_ip, onvif_user, onvif_password, camera_type, action]):
        return jsonify({"status": "error", "message": "Отсутствуют обязательные параметры"}), 400
    
    SELECTED_CAMERA_TYPE_NAME_GLOBAL = camera_type 

    if action == 'move':
        pan = data.get('pan', 0.0) # type: ignore
        tilt = data.get('tilt', 0.0) # type: ignore
        zoom = data.get('zoom', 0.0) # type: ignore
        return send_ptz_request(camera_ip, camera_type, onvif_user, onvif_password, 
                                build_continuous_move_content, "ContinuousMove",
                                x=pan, y=tilt, z=zoom)
    elif action == 'stop':
        return send_ptz_request(camera_ip, camera_type, onvif_user, onvif_password,
                                build_stop_content, "Stop")
    else:
        return jsonify({"status": "error", "message": "Неизвестное действие"}), 400


# Код для MJPEG стриминга (можно убрать или оставить для сравнения)
# @app.route('/api/video-stream') ...

def cleanup_webrtc_resources():
    logger.info("Закрытие WebRTC ресурсов...")
    if background_loop and background_loop.is_running():
        # Закрываем все активные PeerConnections
        if pcs:
            close_tasks = [pc.close() for pc in list(pcs)] # Копируем сет перед итерацией
            future = asyncio.run_coroutine_threadsafe(asyncio.gather(*close_tasks, return_exceptions=True), background_loop) # type: ignore
            try:
                future.result(timeout=5) # Даем время на закрытие
                logger.info(f"Закрыто {len(close_tasks)} PeerConnection(s).")
            except asyncio.TimeoutError:
                logger.warning("Таймаут при закрытии PeerConnection(s).")
            except Exception as e:
                logger.error(f"Ошибка при закрытии PeerConnection(s): {e}", exc_info=True)
            pcs.clear()
        
        # Останавливаем фоновый цикл
        background_loop.call_soon_threadsafe(background_loop.stop)
        # Даем потоку время завершиться
        if rtsp_thread and rtsp_thread.is_alive():
            rtsp_thread.join(timeout=5) 
            if rtsp_thread.is_alive():
                 logger.warning("Фоновый поток RTSP/WebRTC не завершился корректно.")
    logger.info("WebRTC ресурсы очищены.")


if __name__ == '__main__':
    rtsp_thread = threading.Thread(target=run_background_async_tasks, daemon=True)
    rtsp_thread.start()
    
    try:
        logger.info("Запуск Flask сервера...")
        app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
    except KeyboardInterrupt:
        logger.info("Получен сигнал KeyboardInterrupt. Остановка сервера...")
    finally:
        cleanup_webrtc_resources()
        logger.info("Сервер остановлен.")