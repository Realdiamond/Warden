package com.monitor.child

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Foreground service that keeps the permanent "monitoring is on" notice visible and reports the
 * device location to the API. The ongoing notification is the overtness guarantee: it cannot be
 * swiped away while monitoring runs.
 */
class MonitorService : Service() {

    private lateinit var fused: FusedLocationProviderClient
    private lateinit var store: Store
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var callback: LocationCallback? = null
    private var usageJob: Job? = null
    private var commandJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
        fused = LocationServices.getFusedLocationProviderClient(this)
        startForeground(NOTIF_ID, buildNotification())
    }

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val token = store.deviceToken
        if (token.isNullOrEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (callback == null) {
            val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, INTERVAL_MS)
                .setMinUpdateIntervalMillis(INTERVAL_MS)
                .build()
            val cb = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    val loc = result.lastLocation ?: return
                    val capturedAt = Instant.now().toString()
                    val accuracy = if (loc.hasAccuracy()) loc.accuracy else null
                    scope.launch {
                        Api(store.baseUrl).postLocation(token, loc.latitude, loc.longitude, accuracy, capturedAt)
                    }
                }
            }
            callback = cb
            try {
                fused.requestLocationUpdates(request, cb, Looper.getMainLooper())
            } catch (e: SecurityException) {
                // Location permission has not been granted yet; the pairing screen requests it.
            }
        }
        if (usageJob == null) {
            usageJob = scope.launch {
                while (isActive) {
                    try {
                        UsageReporter(this@MonitorService, store).reportNow()
                    } catch (e: Exception) {
                        // ignore a single failed usage report; try again next cycle
                    }
                    try {
                        CallLogReporter(this@MonitorService, store).reportNew()
                    } catch (e: Exception) {
                        // ignore a single failed call-log report; try again next cycle
                    }
                    try {
                        val rules = Api(store.baseUrl).getRules(token)
                        if (rules != null) store.blockedApps = rules
                    } catch (e: Exception) {
                        // keep the last known block list on failure
                    }
                    delay(USAGE_INTERVAL_MS)
                }
            }
        }
        if (commandJob == null) {
            commandJob = scope.launch {
                while (isActive) {
                    try {
                        pollCommands(token)
                    } catch (e: Exception) {
                        // retry next cycle
                    }
                    delay(COMMAND_INTERVAL_MS)
                }
            }
        }
        return START_STICKY
    }

    private suspend fun pollCommands(token: String) {
        val api = Api(store.baseUrl)
        val commands = api.getCommands(token)
        if (commands.isEmpty()) return
        val done = ArrayList<String>()
        for ((id, type) in commands) {
            executeCommand(type)
            done.add(id) // ack either way so a command is not retried forever
        }
        api.ackCommands(token, done)
    }

    private fun executeCommand(type: String) {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, MonitorAdminReceiver::class.java)
        if (!dpm.isAdminActive(admin)) return
        try {
            when (type) {
                "lock" -> dpm.lockNow()
                "unlock" ->
                    // Clearing the lock only works when the app is the device owner.
                    if (dpm.isDeviceOwnerApp(packageName)) {
                        @Suppress("DEPRECATION")
                        dpm.resetPassword("", 0)
                    }
            }
        } catch (e: Exception) {
            // e.g. SecurityException when not permitted on this device
        }
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL,
                getString(R.string.notice_channel),
                NotificationManager.IMPORTANCE_LOW,
            )
            channel.description = getString(R.string.notice_desc)
            manager.createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.notice_title))
            .setContentText(getString(R.string.notice_text))
            .setSmallIcon(R.drawable.ic_notice)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        callback?.let { fused.removeLocationUpdates(it) }
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIF_ID = 1001
        private const val CHANNEL = "monitor_notice"
        private const val INTERVAL_MS = 60_000L
        private const val USAGE_INTERVAL_MS = 15L * 60 * 1000
        private const val COMMAND_INTERVAL_MS = 45L * 1000

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, MonitorService::class.java))
        }
    }
}
