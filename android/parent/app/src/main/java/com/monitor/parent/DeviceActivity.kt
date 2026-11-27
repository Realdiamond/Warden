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
            val api = Api(store.baseUrl, token)
            val events = api.locationEvents(deviceId, 200)
            val msgs = api.messages(deviceId, 100)
            val calls = api.calls(deviceId, 100)

            binding.status.text = ""

            binding.messages.text = if (msgs.isEmpty()) {
                getString(R.string.none)
            } else {
                msgs.joinToString("\n\n") { m ->
                    val tag = if (m.source == "chat") " · on-screen" else ""
                    "${m.sender ?: "Unknown"} · ${appLabel(m.app)}$tag\n${m.text}"
                }
            }

            binding.calls.text = if (calls.isEmpty()) {
                getString(R.string.none)
            } else {
                calls.joinToString("\n") { c ->
                    "${c.direction}  ${c.number ?: "Unknown"}  ${c.durationSec}s"
                }
            }

            latest = events.firstOrNull()
            val first = events.firstOrNull()
            if (first == null) {
                binding.latest.text = getString(R.string.no_location)
                binding.history.text = getString(R.string.none)
                binding.openMap.isEnabled = false
            } else {
                binding.latest.text = getString(R.string.latest_fmt, first.lat, first.lon, first.capturedAt)
                binding.openMap.isEnabled = true
                binding.history.text = events.joinToString("\n") {
                    "${it.capturedAt} — ${"%.5f".format(it.lat)}, ${"%.5f".format(it.lon)}"
                }
            }
        }
    }

    private fun appLabel(pkg: String): String = pkg.substringAfterLast('.')
}
