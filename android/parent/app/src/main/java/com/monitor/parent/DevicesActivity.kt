package com.monitor.parent

import android.content.Intent
import android.os.Bundle
import android.util.TypedValue
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.monitor.parent.databinding.ActivityDevicesBinding
import kotlinx.coroutines.launch

class DevicesActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDevicesBinding
    private lateinit var store: Store

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        binding = ActivityDevicesBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.signOut.setOnClickListener {
            store.signOut()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        load()
    }

    private fun load() {
        val token = store.token ?: return
        binding.status.text = getString(R.string.loading)
        lifecycleScope.launch {
            val devices = Api(store.baseUrl, token).listDevices()
            binding.list.removeAllViews()
            binding.status.text = if (devices.isEmpty()) getString(R.string.no_devices) else ""
            for (device in devices) binding.list.addView(deviceRow(device))
        }
    }

    private fun deviceRow(device: DeviceSummary): TextView {
        val row = TextView(this)
        val pad = dp(14)
        row.setPadding(pad, pad, pad, pad)
        val name = device.name ?: getString(R.string.unnamed)
        val state = if (device.pairedAt != null) getString(R.string.paired) else getString(R.string.awaiting)
        val seen = device.lastSeenAt?.let { getString(R.string.last_seen, it) } ?: getString(R.string.never_seen)
        row.text = "$name\n$state · $seen"
        row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        row.setBackgroundResource(R.drawable.card_bg)
        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
        params.setMargins(0, 0, 0, dp(10))
        row.layoutParams = params
        row.setOnClickListener {
            val intent = Intent(this, DeviceActivity::class.java)
            intent.putExtra("deviceId", device.id)
            intent.putExtra("deviceName", name)
            startActivity(intent)
        }
        return row
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
