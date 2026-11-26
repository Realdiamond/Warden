package com.monitor.child

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Reads per-app foreground time from UsageStatsManager and reports it as `app_usage` events.
 * Needs the special "Usage access" permission, which the pairing screen helps the user grant.
 */
class UsageReporter(private val context: Context, private val store: Store) {

    suspend fun reportNow(): Unit = withContext(Dispatchers.IO) {
        val token = store.deviceToken ?: return@withContext
        if (!hasUsageAccess(context)) return@withContext
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return@withContext

        val end = System.currentTimeMillis()
        val start = end - DAY_MS
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end) ?: return@withContext

        // One package can appear in several buckets; sum the foreground time per package.
        val totals = HashMap<String, Long>()
        for (entry in stats) {
            if (entry.totalTimeInForeground > 0) {
                totals[entry.packageName] = (totals[entry.packageName] ?: 0L) + entry.totalTimeInForeground
            }
        }

        val api = Api(store.baseUrl)
        val capturedAt = Instant.now().toString()
        totals.entries
            .filter { it.value >= MIN_MS }
            .sortedByDescending { it.value }
            .take(MAX_APPS)
            .forEach { api.postAppUsage(token, it.key, it.value, capturedAt) }
    }

    companion object {
        private const val DAY_MS = 24L * 60 * 60 * 1000
        private const val MIN_MS = 1000L
        private const val MAX_APPS = 50

        fun hasUsageAccess(context: Context): Boolean {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.packageName,
                )
            }
            return mode == AppOpsManager.MODE_ALLOWED
        }
    }
}
