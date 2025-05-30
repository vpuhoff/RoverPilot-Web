from flask import Flask, render_template, request, jsonify
from flask_cors import CORS # type: ignore
import cv2 # type: ignore
import asyncio
import uuid
import threading
import logging # Используем стандартный logging
from aiortc import RTCIceCandidate, RTCPeerConnection, RTCSessionDescription # type: ignore
from aiortc.contrib.media import MediaPlayer, MediaRelay # type: ignore

# --- Настройка логирования ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Глобальные переменные ---
app = Flask(__name__)
CORS(app)

pcs = set() # Хранилище для RTCPeerConnection объектов
# RTSP URL можно будет передавать через запрос или конфигурацию
DEFAULT_RTSP_URL = "rtsp://admin:123456@192.168.0.167:554" # Замените на ваш URL
media_relay = MediaRelay()
rtsp_video_track_source = None # Источник трека от MediaPlayer для ретрансляции

# Глобальный asyncio loop для фоновых задач WebRTC и RTSP
background_loop = None
rtsp_thread = None

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
# @app.route('/api/ptz', methods=['POST']) ...

# Код для MJPEG стриминга (можно убрать или оставить для сравнения)
# @app.route('/api/video-stream') ...

def cleanup_webrtc_resources():
    logger.info("Закрытие WebRTC ресурсов...")
    if background_loop and background_loop.is_running():
        # Закрываем все активные PeerConnections
        if pcs:
            close_tasks = [pc.close() for pc in list(pcs)] # Копируем сет перед итерацией
            future = asyncio.run_coroutine_threadsafe(asyncio.gather(*close_tasks, return_exceptions=True), background_loop)
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