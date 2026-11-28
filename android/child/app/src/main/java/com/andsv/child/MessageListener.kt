package com.andsv.child

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.Collections

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

    // Bounded set of recently-sent fingerprints so re-posted notifications aren't duplicated.
    private val recent: MutableSet<String> = Collections.newSetFromMap(
        object : LinkedHashMap<String, Boolean>(256, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean =
                size > 300
        },
    )

    override fun onCreate() {
        super.onCreate()
        store = Store(this)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        alive = true
    }

    override fun onListenerDisconnected() {
        alive = false
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        alive = false
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val token = store.deviceToken ?: return
        val pkg = sbn.packageName ?: return
        if (pkg == packageName || pkg !in MESSAGING_APPS) return

        // Skip WhatsApp's "N new messages" roll-up summary notifications.
        if ((sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val extras = sbn.notification.extras
        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
        if (text.isNullOrBlank() || NOISE.matches(text)) return

        // De-duplicate: WhatsApp re-posts the same notification as a chat updates.
        synchronized(recent) {
            if (!recent.add("$pkg|$sender|$text")) return
        }

        val capturedAt = Instant.now().toString()
        lastCaptureAtMs = System.currentTimeMillis()
        scope.launch {
            EventSink.message(applicationContext, pkg, sender, text, capturedAt, source = "notification")
        }
    }

    companion object {
        // Whether the notification listener is actually bound and running (Samsung can kill it while
        // the permission still shows "on"), and when it last captured something.
        @Volatile
        var alive = false

        @Volatile
        var lastCaptureAtMs = 0L

        // WhatsApp/others post summary texts like "3 new messages" — not real content.
        private val NOISE = Regex(
            "^(\\d+ new messages?|\\d+ messages? from \\d+ chats?|checking for new messages\\.?|you have new messages|new message)$",
            RegexOption.IGNORE_CASE,
        )

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
