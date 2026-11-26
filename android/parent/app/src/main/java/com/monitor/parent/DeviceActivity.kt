package com.monitor.parent

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.monitor.parent.databinding.ActivityDeviceBinding
import kotlinx.coroutines.launch

class DeviceActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDeviceBinding
    private lateinit var store: Store
    private var latest: LocationEvent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        binding = ActivityDeviceBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val deviceId = intent.getStringExtra("deviceId")
        if (deviceId == null) {
            finish()
            return
        }
        binding.title.text = intent.getStringExtra("deviceName") ?: getString(R.string.app_name)
        binding.openMap.isEnabled = false
        binding.openMap.setOnClickListener {
            latest?.let {
                val uri = Uri.parse("geo:${it.lat},${it.lon}?q=${it.lat},${it.lon}")
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
        }
        load(deviceId)
    }

    private fun load(deviceId: String) {
        val token = store.token ?: return
        binding.status.text = getString(R.string.loading)
        lifecycleScope.launch {
            val events = Api(store.baseUrl, token).locationEvents(deviceId, 200)
            latest = events.firstOrNull()
            val first = events.firstOrNull()
            if (first == null) {
                binding.status.text = getString(R.string.no_location)
                binding.latest.text = ""
                binding.history.text = ""
                binding.openMap.isEnabled = false
            } else {
                binding.status.text = ""
                binding.latest.text = getString(R.string.latest_fmt, first.lat, first.lon, first.capturedAt)
                binding.openMap.isEnabled = true
                binding.history.text = events.joinToString("\n") {
                    "${it.capturedAt} — ${"%.5f".format(it.lat)}, ${"%.5f".format(it.lon)}"
                }
            }
        }
    }
}
