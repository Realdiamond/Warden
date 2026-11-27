package com.andsv.child

import android.app.Application
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Captures any uncaught exception and stores its stack trace, so the next launch can show it
 * on-screen for diagnosis — there is no logcat access on the monitored phone. After storing, it
 * delegates to the platform's default handler so the OS still ends the process normally.
 */
class MonitorApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val store = Store(this)
                store.lastCrash = "thread=${thread.name}\n$sw".take(5000)
                store.crashSeen = false
            } catch (_: Throwable) {
                // never let the crash handler itself throw
            }
            previous?.uncaughtException(thread, throwable)
        }
    }
}
