package com.andsv.child

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Flushes the Outbox to the server in batches whenever there is a connection. Events are deleted
 * locally only after the server confirms them; on any failure the work is retried with backoff,
 * so a dead zone just delays delivery instead of losing data.
 */
class SyncWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val store = Store(applicationContext)
        val token = store.deviceToken ?: return Result.success() // not paired; nothing to send
        val api = Api(store.baseUrl)
        val outbox = Outbox.get(applicationContext)

        while (true) {
            val rows = outbox.peek(BATCH)
            if (rows.isEmpty()) return Result.success()

            val events = JSONArray()
            for (r in rows) {
                val payload = try {
                    JSONObject(r.payload)
                } catch (_: Exception) {
                    JSONObject()
                }
                events.put(
                    JSONObject()
                        .put("kind", r.kind)
                        .put("capturedAt", r.capturedAt)
                        .put("clientId", r.clientId)
                        .put("payload", payload),
                )
            }

            val code = api.postBatch(token, events)
            if (code in 200..299) {
                outbox.delete(rows.map { it.id })
                if (rows.size < BATCH) return Result.success() // drained
                // else there may be more — loop again
            } else {
                // Network down, server error, or auth not ready: keep the data and try again later.
                return Result.retry()
            }
        }
    }

    companion object {
        private const val BATCH = 100
        private const val UNIQUE_NOW = "andsv-sync"
        private const val UNIQUE_PERIODIC = "andsv-sync-periodic"

        private fun constraints() =
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Flush as soon as there is a connection. Coalesces with any already-scheduled flush. */
        fun scheduleNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_NOW, ExistingWorkPolicy.KEEP, req)
        }

        /** Safety net: a periodic flush so nothing lingers if an immediate flush was ever missed. */
        fun schedulePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
