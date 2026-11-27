package com.monitor.child

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * A snapshot of which phone-side permissions Monitor currently holds. Reported to the server as a
 * `status` event so the parent dashboard can show a "finish setup" checklist — the dashboard can't
 * read the phone's settings directly, and can't turn these on remotely (Android only lets the phone
 * do that), so this status is how it knows what's still missing.
 */
object Permissions {
    fun location(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun usage(ctx: Context): Boolean = UsageReporter.hasUsageAccess(ctx)

    fun notifications(ctx: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    fun accessibility(ctx: Context): Boolean {
        val enabled = Settings.Secure.getString(
            ctx.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabled.split(":").any { it.startsWith("${ctx.packageName}/") }
    }

    fun deviceAdmin(ctx: Context): Boolean {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isAdminActive(ComponentName(ctx, MonitorAdminReceiver::class.java))
    }

    /** Whether the OS is letting Monitor run freely in the background (not battery-restricted). */
    fun batteryUnrestricted(ctx: Context): Boolean {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    /**
     * All permission states plus whether the capture services are actually running, for the `status`
     * event. `accessibility`/`notifications` report the granted permission; `*Running` report whether
     * the service is really bound (Samsung can kill it while the permission still shows "on").
     */
    fun asJson(ctx: Context): JSONObject = JSONObject()
        .put("location", location(ctx))
        .put("usage", usage(ctx))
        .put("notifications", notifications(ctx))
        .put("accessibility", accessibility(ctx))
        .put("deviceAdmin", deviceAdmin(ctx))
        .put("accessibilityRunning", ChatReaderService.instance != null)
        .put("notificationsRunning", MessageListener.alive)
        .put("batteryUnrestricted", batteryUnrestricted(ctx))
}
