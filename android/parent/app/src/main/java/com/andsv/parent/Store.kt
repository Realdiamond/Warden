package com.andsv.parent

import android.content.Context

/** Local settings for the parent app: API address and the signed-in account token (JWT). */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("andsv_parent", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString("baseUrl", DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        set(value) {
            prefs.edit().putString("baseUrl", value).apply()
        }

    var token: String?
        get() = prefs.getString("token", null)
        set(value) {
            prefs.edit().putString("token", value).apply()
        }

    val isLoggedIn: Boolean
        get() = !token.isNullOrEmpty()

    fun signOut() {
        prefs.edit().remove("token").apply()
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://andsv-api.homegoing.workers.dev"
    }
}
