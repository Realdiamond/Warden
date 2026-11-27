package com.andsv.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restart monitoring after the phone reboots, if the device has been paired. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && Store(context).isPaired) {
            AndsvService.start(context)
        }
    }
}
