package com.andsv.child

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/**
 * The real launcher entry. It only opens the pairing/settings screen and finishes. Keeping the
 * launcher as its own activity (rather than an alias) lets it be disabled to hide the app icon —
 * some One UI builds honour disabling a real activity more reliably than an alias.
 */
class LauncherActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, PairingActivity::class.java))
        finish()
    }
}
