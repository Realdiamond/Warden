package com.andsv.parent

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class DeviceSummary(
    val id: String,
    val name: String?,
    val pairedAt: String?,
    val consentAcceptedAt: String?,
    val lastSeenAt: String?,
)

data class LocationEvent(
    val lat: Double,
    val lon: Double,
    val accuracyM: Double?,
    val capturedAt: String,
)

data class MessageItem(
    val app: String,
    val sender: String?,
    val text: String,
    val source: String?,
    val capturedAt: String,
)

data class CallItem(
    val number: String?,
    val direction: String,
    val durationSec: Long,
    val capturedAt: String,
)

class Api(private val baseUrl: String, private val token: String? = null) {

    suspend fun authenticate(email: String, password: String, signup: Boolean): AuthResult =
        withContext(Dispatchers.IO) {
            val path = if (signup) "/v1/accounts" else "/v1/sessions"
            val body = JSONObject().put("email", email).put("password", password)
            val (code, text) = request("POST", path, body.toString())
            if (code in 200..299) {
                AuthResult.Success(JSONObject(text).getString("token"))
            } else {
                AuthResult.Failure(errorCode(code, text))
            }
        }

    suspend fun listDevices(): List<DeviceSummary> = withContext(Dispatchers.IO) {
        val (code, text) = request("GET", "/v1/devices", null)
        if (code !in 200..299) return@withContext emptyList()
        val arr = JSONObject(text).getJSONArray("devices")
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            DeviceSummary(
                o.getString("id"),
                o.optStringOrNull("name"),
                o.optStringOrNull("pairedAt"),
                o.optStringOrNull("consentAcceptedAt"),
                o.optStringOrNull("lastSeenAt"),
            )
        }
    }

    suspend fun locationEvents(deviceId: String, limit: Int = 100): List<LocationEvent> =
        withContext(Dispatchers.IO) {
            val path = "/v1/devices/" + URLEncoder.encode(deviceId, "UTF-8") + "/events?kind=location&limit=" + limit
            val (code, text) = request("GET", path, null)
            if (code !in 200..299) return@withContext emptyList()
            val arr = JSONObject(text).getJSONArray("events")
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val p = o.optJSONObject("payload") ?: return@mapNotNull null
                LocationEvent(
                    p.getDouble("lat"),
                    p.getDouble("lon"),
                    if (p.has("accuracyM")) p.getDouble("accuracyM") else null,
                    o.getString("capturedAt"),
                )
            }
        }

    suspend fun messages(deviceId: String, limit: Int = 100): List<MessageItem> =
        withContext(Dispatchers.IO) {
            val path = "/v1/devices/" + URLEncoder.encode(deviceId, "UTF-8") + "/events?kind=message&limit=" + limit
            val (code, text) = request("GET", path, null)
            if (code !in 200..299) return@withContext emptyList()
            val arr = JSONObject(text).getJSONArray("events")
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val p = o.optJSONObject("payload") ?: return@mapNotNull null
                MessageItem(
                    p.optString("app"),
                    p.optStringOrNull("sender"),
                    p.optString("text"),
                    p.optStringOrNull("source"),
                    o.getString("capturedAt"),
                )
            }
        }

    suspend fun calls(deviceId: String, limit: Int = 100): List<CallItem> =
        withContext(Dispatchers.IO) {
            val path = "/v1/devices/" + URLEncoder.encode(deviceId, "UTF-8") + "/events?kind=call&limit=" + limit
            val (code, text) = request("GET", path, null)
            if (code !in 200..299) return@withContext emptyList()
            val arr = JSONObject(text).getJSONArray("events")
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val p = o.optJSONObject("payload") ?: return@mapNotNull null
                CallItem(
                    p.optStringOrNull("number"),
                    p.optString("direction"),
                    p.optLong("durationSec"),
                    o.getString("capturedAt"),
                )
            }
        }

    private fun request(method: String, path: String, json: String?): Pair<Int, String> {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Content-Type", "application/json")
        if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
        if (json != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
        }
        return try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            code to (stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } catch (e: Exception) {
            0 to "network_error"
        } finally {
            connection.disconnect()
        }
    }

    private fun errorCode(code: Int, text: String): String =
        try {
            JSONObject(text).optString("error", "request_failed")
        } catch (e: Exception) {
            if (code == 0) "network_error" else "request_failed"
        }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key)

sealed class AuthResult {
    data class Success(val token: String) : AuthResult()
    data class Failure(val error: String) : AuthResult()
}
