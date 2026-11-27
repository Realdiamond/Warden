package com.monitor.child

import android.content.Context

/**
 * Local settings for the monitored device: where the API lives, the device token issued at
 * pairing, and the recorded consent timestamp.
 *
 * The device token is this device's own credential; the monitored person has consented, so plain
 * SharedPreferences is acceptable for now. Moving to EncryptedSharedPreferences is a hardening
 * follow-up tracked in docs/milestones.md.
 */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("monitor", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        set(value) {
            prefs.edit().putString(KEY_BASE_URL, value).apply()
        }

    var deviceToken: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) {
            prefs.edit().putString(KEY_TOKEN, value).apply()
        }

    var consentAcceptedAt: String?
        get() = prefs.getString(KEY_CONSENT, null)
        set(value) {
            prefs.edit().putString(KEY_CONSENT, value).apply()
        }

    // Only calls newer than this have been reported (epoch millis). Defaults to a week back so the
    // first report picks up recent history.
    var lastCallMillis: Long
        get() = prefs.getLong(KEY_LAST_CALL, System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000)
        set(value) {
            prefs.edit().putLong(KEY_LAST_CALL, value).apply()
        }

    // App packages the parent has chosen to block on this device.
    var blockedApps: Set<String>
        get() = prefs.getStringSet(KEY_BLOCKED, emptySet()) ?: emptySet()
        set(value) {
            prefs.edit().putStringSet(KEY_BLOCKED, value).apply()
        }

    // The most recent uncaught-crash stack trace, captured by MonitorApp and surfaced on next launch
    // so it can be screenshotted for diagnosis (no logcat access on the phone).
    var lastCrash: String?
        get() = prefs.getString(KEY_CRASH, null)
        set(value) {
            prefs.edit().putString(KEY_CRASH, value).apply()
        }

    // Whether the launcher icon is currently hidden from the app drawer.
    var iconHidden: Boolean
        get() = prefs.getBoolean(KEY_ICON_HIDDEN, false)
        set(value) {
            prefs.edit().putBoolean(KEY_ICON_HIDDEN, value).apply()
        }

    val isPaired: Boolean
        get() = !deviceToken.isNullOrEmpty()

    companion object {
        private const val KEY_BASE_URL = "baseUrl"
        private const val KEY_TOKEN = "deviceToken"
        private const val KEY_CONSENT = "consentAcceptedAt"
        private const val KEY_LAST_CALL = "lastCallMillis"
        private const val KEY_BLOCKED = "blockedApps"
        private const val KEY_CRASH = "lastCrash"
        private const val KEY_ICON_HIDDEN = "iconHidden"

        // The deployed API. Overridable on the pairing screen during testing.
        const val DEFAULT_BASE_URL = "https://monitor-api.homegoing.workers.dev"
    }
}
