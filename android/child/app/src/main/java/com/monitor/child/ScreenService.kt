package com.monitor.child

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Captures the screen (MediaProjection) and streams JPEG frames to the relay while a parent is
 * watching. Also receives tap commands and performs them through the accessibility service
 * (remote control). A permanent notice stays up while this runs.
 */
class ScreenService : Service() {

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var ws: WebSocket? = null

    @Volatile private var viewers = 0
    private var lastSent = 0L
    private lateinit var store: Store
    private var screenW = 0
    private var screenH = 0
    private var capW = 0
    private var capH = 0

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
        if (code == 0 || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        screenW = metrics.widthPixels
        screenH = metrics.heightPixels
        val scale = minOf(1f, MAX_WIDTH.toFloat() / screenW)
        capW = (screenW * scale).toInt().coerceAtLeast(1)
        capH = (screenH * scale).toInt().coerceAtLeast(1)

        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = manager.getMediaProjection(code, data)
        projection?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                cleanup()
                stopSelf()
            }
        }, null)

        reader = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 2)
        virtualDisplay = projection?.createVirtualDisplay(
            "monitor-screen",
            capW,
            capH,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader!!.surface,
            null,
            null,
        )
        reader?.setOnImageAvailableListener({ r -> onFrame(r) }, null)
        connect()
        return START_STICKY
    }

    private fun connect() {
        val token = store.deviceToken ?: return
        val base = store.baseUrl.replace("https://", "wss://").replace("http://", "ws://")
        val request = Request.Builder().url("$base/v1/stream/source?token=$token").build()
        ws = OkHttpClient().newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(JSONObject().put("type", "meta").put("w", screenW).put("h", screenH).toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val j = JSONObject(text)
                        when (j.optString("type")) {
                            "viewers" -> viewers = j.optInt("count", 0)
                            "tap" -> ChatReaderService.instance?.tap(
                                j.optDouble("x").toFloat(),
                                j.optDouble("y").toFloat(),
                            )
                        }
                    } catch (e: Exception) {
                        // ignore malformed control message
                    }
                }
            },
        )
    }

    private fun onFrame(r: ImageReader) {
        val image = try {
            r.acquireLatestImage()
        } catch (e: Exception) {
            null
        } ?: return
        try {
            if (viewers <= 0) return
            val now = System.currentTimeMillis()
            if (now - lastSent < FRAME_INTERVAL_MS) return
            lastSent = now

            val plane = image.planes[0]
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * capW
            val bmp = Bitmap.createBitmap(capW + rowPadding / pixelStride, capH, Bitmap.Config.ARGB_8888)
            bmp.copyPixelsFromBuffer(plane.buffer)
            val out = if (rowPadding == 0) bmp else Bitmap.createBitmap(bmp, 0, 0, capW, capH)

            val baos = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, 40, baos)
            ws?.send(baos.toByteArray().toByteString())

            if (out !== bmp) bmp.recycle()
            out.recycle()
        } catch (e: Exception) {
            // skip this frame
        } finally {
            image.close()
        }
    }

    private fun startInForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, getString(R.string.screen_channel), NotificationManager.IMPORTANCE_LOW),
            )
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.screen_notice_title))
            .setContentText(getString(R.string.screen_notice_text))
            .setSmallIcon(R.drawable.ic_notice)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun cleanup() {
        try {
            ws?.close(1000, null)
        } catch (e: Exception) {
            // ignore
        }
        virtualDisplay?.release()
        reader?.close()
        projection?.stop()
        ws = null
        virtualDisplay = null
        reader = null
        projection = null
    }

    override fun onDestroy() {
        cleanup()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIF_ID = 1002
        private const val CHANNEL = "monitor_screen"
        private const val FRAME_INTERVAL_MS = 500L // ~2 frames/second
        private const val MAX_WIDTH = 480
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"

        fun start(context: Context, code: Int, data: Intent) {
            val intent = Intent(context, ScreenService::class.java)
            intent.putExtra(EXTRA_CODE, code)
            intent.putExtra(EXTRA_DATA, data)
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
