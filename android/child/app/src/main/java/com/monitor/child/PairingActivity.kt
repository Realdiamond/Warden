package com.monitor.child

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.monitor.child.databinding.ActivityPairingBinding
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Launcher screen. Shows what the app does (openly), takes the pairing code and an explicit
 * consent tick, pairs with the API, then starts the monitoring service.
 */
class PairingActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPairingBinding
    private lateinit var store: Store

    private val foregroundPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { requestBackgroundLocationIfNeeded() }

    private val backgroundPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { startMonitoring() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        binding = ActivityPairingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.baseUrl.setText(store.baseUrl)

        if (store.isPaired) {
            binding.pairCode.isEnabled = false
            binding.consentCheckbox.isEnabled = false
            binding.pairButton.isEnabled = false
            binding.status.text = getString(R.string.already_paired)
            ensureLocationPermissions()
            return
        }

        binding.pairButton.setOnClickListener { attemptPair() }
    }

    override fun onResume() {
        super.onResume()
        updateUsageButton()
    }

    private fun updateUsageButton() {
        if (store.isPaired && !UsageReporter.hasUsageAccess(this)) {
            binding.usageAccessButton.visibility = View.VISIBLE
            binding.usageAccessButton.setOnClickListener {
                startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            }
        } else {
            binding.usageAccessButton.visibility = View.GONE
        }
    }

    private fun attemptPair() {
        if (!binding.consentCheckbox.isChecked) {
            Toast.makeText(this, R.string.must_consent, Toast.LENGTH_LONG).show()
            return
        }
        val code = binding.pairCode.text.toString().trim()
        if (code.isEmpty()) {
            Toast.makeText(this, R.string.enter_code, Toast.LENGTH_SHORT).show()
            return
        }
        store.baseUrl = binding.baseUrl.text.toString().trim()
        val consentAt = Instant.now().toString()

        binding.pairButton.isEnabled = false
        binding.status.text = getString(R.string.pairing)

        lifecycleScope.launch {
            val deviceName = Build.MODEL ?: "Android device"
            val result = Api(store.baseUrl).pair(code, deviceName, BuildConfig.VERSION_NAME, consentAt)
            when (result) {
                is PairResult.Success -> {
                    store.deviceToken = result.deviceToken
                    store.consentAcceptedAt = consentAt
                    binding.status.text = getString(R.string.paired_ok)
                    ensureLocationPermissions()
                }
                is PairResult.Failure -> {
                    binding.pairButton.isEnabled = true
                    binding.status.text = getString(R.string.pair_failed, result.error)
                }
            }
        }
    }

    private fun ensureLocationPermissions() {
        val needed = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            requestBackgroundLocationIfNeeded()
        } else {
            foregroundPermissions.launch(missing.toTypedArray())
        }
    }

    private fun requestBackgroundLocationIfNeeded() {
        val fineGranted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            fineGranted &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            backgroundPermission.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        } else {
            startMonitoring()
        }
    }

    private fun startMonitoring() {
        MonitorService.start(this)
        binding.status.text = getString(R.string.monitoring_on)
        binding.pairButton.isEnabled = false
    }
}
