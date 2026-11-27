package com.andsv.child

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Transparent activity that shows Android's required "allow screen capture" dialog, then starts the
 * screen-sharing service with the user's permission. This is the overt consent step — Android
 * forces this dialog and shows an indicator while capture is active.
 */
class ProjectionActivity : AppCompatActivity() {

    private val launcher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            try {
                ScreenService.start(this, result.resultCode, data)
            } catch (t: Throwable) {
                Toast.makeText(this, R.string.screen_share_failed, Toast.LENGTH_LONG).show()
            }
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            launcher.launch(manager.createScreenCaptureIntent())
        } catch (t: Throwable) {
            Toast.makeText(this, R.string.screen_share_failed, Toast.LENGTH_LONG).show()
            finish()
        }
    }
}
