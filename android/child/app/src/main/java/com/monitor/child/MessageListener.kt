package com.monitor.child

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Captures incoming message notifications (sender + text) from common messaging apps and reports
 * them as `message` events. This is the realistic on-device technique for "see messages": it reads
 * notifications as they arrive, not full chat history or outgoing messages. Message text is a
 * sensitive kind and is encrypted at rest by the API.
 *
 * Requires the user to grant "Notification access" (the pairing screen links to it).
 */
class MessageListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var store: Store

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val token = store.deviceToken ?: return
        val pkg = sbn.packageName ?: return
        if (pkg == packageName || pkg !in MESSAGING_APPS) return

        val extras = sbn.notification.extras
        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        if (text.isNullOrBlank()) return

        val capturedAt = Instant.now().toString()
        scope.launch {
            Api(store.baseUrl).postMessage(token, pkg, sender, text, capturedAt, source = "notification")
        }
    }

    companion object {
        private val MESSAGING_APPS = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b",
            "org.telegram.messenger",
            "com.facebook.orca",
            "com.instagram.android",
            "com.google.android.apps.messaging",
            "com.android.messaging",
            "com.android.mms",
            "com.snapchat.android",
            "com.discord",
            "com.viber.voip",
        )
    }
}
