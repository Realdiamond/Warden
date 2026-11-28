package com.andsv.child

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/**
 * The single place every captured event goes. It writes the event to the local Outbox (never a
 * direct network call) and nudges the SyncWorker, which uploads buffered events whenever there is
 * a connection. Nothing is lost offline; a re-send is de-duplicated server-side by clientId.
 */
object EventSink {

    private fun enqueue(context: Context, kind: String, capturedAt: String, payload: JSONObject) {
        // Only buffer once the phone is paired — i.e. consent has been recorded. Nothing before that.
        if (!Store(context).isPaired) return
        Outbox.get(context).enqueue(UUID.randomUUID().toString(), kind, capturedAt, payload.toString())
        SyncWorker.scheduleNow(context)
    }

    fun message(
        context: Context,
        app: String,
        sender: String?,
        text: String,
        capturedAt: String,
        source: String? = null,
        direction: String? = null,
        conversation: String? = null,
    ) {
        val p = JSONObject().put("app", app).put("text", text)
        if (sender != null) p.put("sender", sender)
        if (source != null) p.put("source", source)
        if (direction != null) p.put("direction", direction)
        if (conversation != null) p.put("conversation", conversation)
        enqueue(context, "message", capturedAt, p)
    }

    fun call(
        context: Context,
        number: String?,
        name: String?,
        direction: String,
        durationSec: Long,
        capturedAt: String,
    ) {
        val p = JSONObject().put("direction", direction).put("durationSec", durationSec)
        if (number != null) p.put("number", number)
        if (name != null) p.put("name", name)
        enqueue(context, "call", capturedAt, p)
    }

    fun location(context: Context, lat: Double, lon: Double, accuracyM: Float?, capturedAt: String) {
        val p = JSONObject().put("lat", lat).put("lon", lon)
        if (accuracyM != null) p.put("accuracyM", accuracyM.toDouble())
        enqueue(context, "location", capturedAt, p)
    }

    fun appUsage(context: Context, packageName: String, foregroundMs: Long, capturedAt: String) {
        val p = JSONObject().put("packageName", packageName).put("foregroundMs", foregroundMs)
        enqueue(context, "app_usage", capturedAt, p)
    }
}
