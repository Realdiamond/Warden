package com.andsv.parent

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.andsv.parent.databinding.ActivityDevicesBinding
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

    /** A card row: a device icon chip, name + last-seen, and a colored status pill — mirrors the
     * web dashboard's device card. */
    private fun deviceRow(device: DeviceSummary): View {
        val pad = dp(14)
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(pad, pad, pad, pad)
            setBackgroundResource(R.drawable.bg_panel)
            isClickable = true
            isFocusable = true
            val outValue = TypedValue()
            theme.resolveAttribute(android.R.attr.selectableItemBackground, outValue, true)
            foreground = ContextCompat.getDrawable(this@DevicesActivity, outValue.resourceId)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { setMargins(0, 0, 0, dp(10)) }
        }

        val iconChip = FrameLayout(this).apply {
            setBackgroundResource(R.drawable.bg_chip_brand)
            layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
        }
        val icon = ImageView(this).apply {
            setImageResource(R.drawable.ic_device)
            layoutParams = FrameLayout.LayoutParams(dp(18), dp(18)).apply { gravity = Gravity.CENTER }
        }
        iconChip.addView(icon)

        val name = device.name ?: getString(R.string.unnamed)
        val seen = device.lastSeenAt?.let { getString(R.string.last_seen, it) } ?: getString(R.string.never_seen)

        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(12)
            }
        }
        val nameView = TextView(this).apply {
            text = name
            setTextColor(ContextCompat.getColor(this@DevicesActivity, R.color.ink))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTypeface(typeface, Typeface.BOLD)
        }
        val metaView = TextView(this).apply {
            text = seen
            setTextColor(ContextCompat.getColor(this@DevicesActivity, R.color.faint))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        }
        textCol.addView(nameView)
        textCol.addView(metaView)

        val paired = device.pairedAt != null
        val pill = TextView(this).apply {
            text = if (paired) getString(R.string.paired) else getString(R.string.awaiting)
            val colorRes = if (paired) R.color.ok else R.color.warn
            val bgRes = if (paired) R.drawable.bg_pill_ok else R.drawable.bg_pill_warn
            setTextColor(ContextCompat.getColor(this@DevicesActivity, colorRes))
            setBackgroundResource(bgRes)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(10), dp(5), dp(10), dp(5))
        }

        row.addView(iconChip)
        row.addView(textCol)
        row.addView(pill)

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
