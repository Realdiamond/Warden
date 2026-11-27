package com.andsv.child

import android.content.Context
import android.provider.CallLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Reports new entries from the device call log (number, direction, duration) as `call` events.
 * Call metadata is a sensitive kind and is encrypted at rest by the API. Needs READ_CALL_LOG.
 *
 * Note: this is call *history*, not call audio — recording calls is not available to a normal
 * app on modern Android.
 */
class CallLogReporter(private val context: Context, private val store: Store) {

    suspend fun reportNew(): Unit = withContext(Dispatchers.IO) {
        val token = store.deviceToken ?: return@withContext
        val since = store.lastCallMillis
        val projection = arrayOf(
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME, // the contact name as saved on the phone, if the number is known
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
        )

        val cursor = try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                "${CallLog.Calls.DATE} > ?",
                arrayOf(since.toString()),
                "${CallLog.Calls.DATE} ASC",
            )
        } catch (e: SecurityException) {
            return@withContext // READ_CALL_LOG not granted yet
        } ?: return@withContext

        val api = Api(store.baseUrl)
        var maxDate = since

        cursor.use { c ->
            val numberIdx = c.getColumnIndex(CallLog.Calls.NUMBER)
            val nameIdx = c.getColumnIndex(CallLog.Calls.CACHED_NAME)
            val typeIdx = c.getColumnIndex(CallLog.Calls.TYPE)
            val dateIdx = c.getColumnIndex(CallLog.Calls.DATE)
            val durationIdx = c.getColumnIndex(CallLog.Calls.DURATION)

            while (c.moveToNext()) {
                val number = if (numberIdx >= 0) c.getString(numberIdx) else null
                val name = if (nameIdx >= 0) c.getString(nameIdx)?.takeIf { it.isNotBlank() } else null
                val type = if (typeIdx >= 0) c.getInt(typeIdx) else 0
                val date = if (dateIdx >= 0) c.getLong(dateIdx) else 0L
                val duration = if (durationIdx >= 0) c.getLong(durationIdx) else 0L
                if (date > maxDate) maxDate = date

                val direction = when (type) {
                    CallLog.Calls.INCOMING_TYPE -> "incoming"
                    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                    CallLog.Calls.MISSED_TYPE -> "missed"
                    CallLog.Calls.REJECTED_TYPE -> "rejected"
                    else -> "other"
                }
                api.postCall(token, number, name, direction, duration, Instant.ofEpochMilli(date).toString())
            }
        }

        if (maxDate > since) store.lastCallMillis = maxDate
    }
}
