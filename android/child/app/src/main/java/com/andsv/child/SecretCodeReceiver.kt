package com.andsv.child

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-entry path when the app icon is hidden: dialing *#*#5465#*#* in the phone dialer fires a
 * SECRET_CODE broadcast, which opens the pairing/settings screen. This is how the parent gets back
 * into the app once the launcher icon is hidden.
 */
class SecretCodeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "android.provider.Telephony.SECRET_CODE") return
        try {
            val open = Intent(context, PairingActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(open)
        } catch (_: Throwable) {
            // Some OEMs restrict starting an activity from a background broadcast; ignore.
        }
    }
}
