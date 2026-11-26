package com.monitor.child

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Minimal HTTP client to the Monitor API, using HttpURLConnection + org.json (no extra deps). */
class Api(private val baseUrl: String) {

    suspend fun pair(
        pairCode: String,
        deviceName: String,
        appVersion: String,
        consentAcceptedAt: String,
    ): PairResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("pairCode", pairCode)
            .put("deviceName", deviceName)
            .put("platform", "android")
            .put("appVersion", appVersion)
            .put("consentAcceptedAt", consentAcceptedAt)

        val (code, text) = post("/v1/pairing", body.toString(), null)
        if (code in 200..299) {
            val json = JSONObject(text)
            PairResult.Success(json.getString("deviceId"), json.getString("deviceToken"))
        } else {
            PairResult.Failure(code, errorCode(text))
        }
    }

    suspend fun postLocation(
        token: String,
        lat: Double,
        lon: Double,
        accuracyM: Float?,
        capturedAt: String,
    ): Boolean = withContext(Dispatchers.IO) {
        val payload = JSONObject().put("lat", lat).put("lon", lon)
        if (accuracyM != null) payload.put("accuracyM", accuracyM.toDouble())
        val body = JSONObject()
            .put("kind", "location")
            .put("capturedAt", capturedAt)
            .put("payload", payload)
        val (code, _) = post("/v1/events", body.toString(), token)
        code in 200..299
    }

    private fun post(path: String, json: String, bearer: String?): Pair<Int, String> {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Content-Type", "application/json")
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
        return try {
            connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            code to text
        } catch (e: Exception) {
            0 to "network_error"
        } finally {
            connection.disconnect()
        }
    }

    private fun errorCode(text: String): String =
        try {
            JSONObject(text).optString("error", "request_failed")
        } catch (e: Exception) {
            "request_failed"
        }
}

sealed class PairResult {
    data class Success(val deviceId: String, val deviceToken: String) : PairResult()
    data class Failure(val httpCode: Int, val error: String) : PairResult()
}
