package com.monitor.child

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
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

        showLastCrashIfAny()
        binding.errorLogButton.setOnClickListener { showErrorLog() }
        binding.baseUrl.setText(store.baseUrl)

        if (store.isPaired) {
            binding.pairCode.isEnabled = false
            binding.consentCheckbox.isEnabled = false
            binding.pairButton.isEnabled = false
            setStatus(getString(R.string.already_paired), StatusTone.OK)
            ensureLocationPermissions()
            return
        }

        binding.pairButton.setOnClickListener { attemptPair() }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionButtons()
    }

    private fun updatePermissionButtons() {
        val paired = store.isPaired

        if (paired && !UsageReporter.hasUsageAccess(this)) {
            binding.usageAccessButton.visibility = View.VISIBLE
            binding.usageAccessButton.setOnClickListener {
                startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            }
        } else {
            binding.usageAccessButton.visibility = View.GONE
        }

        if (paired && !hasNotificationAccess()) {
            binding.notifAccessButton.visibility = View.VISIBLE
            binding.notifAccessButton.setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        } else {
            binding.notifAccessButton.visibility = View.GONE
        }

        if (paired && !hasAccessibilityAccess()) {
            binding.accessibilityButton.visibility = View.VISIBLE
            binding.accessibilityButton.setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        } else {
            binding.accessibilityButton.visibility = View.GONE
        }

        if (paired) {
            binding.screenShareButton.visibility = View.VISIBLE
            binding.screenShareButton.setOnClickListener {
                startActivity(Intent(this, ProjectionActivity::class.java))
            }
        } else {
            binding.screenShareButton.visibility = View.GONE
        }

        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, MonitorAdminReceiver::class.java)
        if (paired && !dpm.isAdminActive(admin)) {
            binding.adminButton.visibility = View.VISIBLE
            binding.adminButton.setOnClickListener {
                val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                    .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
                    .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, getString(R.string.admin_explanation))
                startActivity(intent)
            }
        } else {
            binding.adminButton.visibility = View.GONE
        }

        // Hide / show the launcher icon — always available (independent of pairing).
        binding.hideIconButton.setText(if (store.iconHidden) R.string.show_icon else R.string.hide_icon)
        binding.hideIconButton.setOnClickListener {
            if (store.iconHidden) {
                setIconHidden(false)
                Toast.makeText(this, R.string.icon_shown, Toast.LENGTH_LONG).show()
                updatePermissionButtons()
            } else {
                AlertDialog.Builder(this)
                    .setTitle(R.string.hide_icon_title)
                    .setMessage(R.string.hide_icon_message)
                    .setPositiveButton(R.string.confirm) { _, _ ->
                        setIconHidden(true)
                        Toast.makeText(this, R.string.icon_hidden, Toast.LENGTH_LONG).show()
                        updatePermissionButtons()
                    }
                    .setNegativeButton(R.string.cancel, null)
                    .show()
            }
        }
    }

    /** Enable/disable the launcher-icon alias. Disabling removes the icon from the app drawer. */
    private fun setIconHidden(hidden: Boolean) {
        val alias = ComponentName(this, "com.monitor.child.LauncherAlias")
        val state = if (hidden) {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        }
        packageManager.setComponentEnabledSetting(alias, state, PackageManager.DONT_KILL_APP)
        store.iconHidden = hidden
    }

    private fun hasNotificationAccess(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)

    private fun hasAccessibilityAccess(): Boolean {
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabled.split(":").any { it.startsWith("$packageName/") }
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
        setStatus(getString(R.string.pairing), StatusTone.NEUTRAL)

        lifecycleScope.launch {
            val deviceName = Build.MODEL ?: "Android device"
            val result = Api(store.baseUrl).pair(code, deviceName, BuildConfig.VERSION_NAME, consentAt)
            when (result) {
                is PairResult.Success -> {
                    store.deviceToken = result.deviceToken
                    store.consentAcceptedAt = consentAt
                    setStatus(getString(R.string.paired_ok), StatusTone.OK)
                    ensureLocationPermissions()
                }
                is PairResult.Failure -> {
                    binding.pairButton.isEnabled = true
                    setStatus(getString(R.string.pair_failed, result.error), StatusTone.DANGER)
                }
            }
        }
    }

    /** Auto-show the last crash once, right after it happened. */
    private fun showLastCrashIfAny() {
        val trace = store.lastCrash ?: return
        if (store.crashSeen) return
        store.crashSeen = true
        showCrashDialog(trace)
    }

    /** The "View last error log" button — show the last saved crash, or say there is none. */
    private fun showErrorLog() {
        val trace = store.lastCrash
        if (trace == null) {
            Toast.makeText(this, R.string.no_error, Toast.LENGTH_LONG).show()
            return
        }
        showCrashDialog(trace)
    }

    private fun showCrashDialog(trace: String) {
        AlertDialog.Builder(this)
            .setTitle(R.string.last_error_title)
            .setMessage(trace)
            .setPositiveButton("Copy") { _, _ ->
                val cb = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cb.setPrimaryClip(android.content.ClipData.newPlainText("monitor-crash", trace))
                Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Dismiss", null)
            .show()
    }

    private enum class StatusTone { NEUTRAL, OK, DANGER }

    private fun setStatus(text: String, tone: StatusTone) {
        binding.status.text = text
        val colorRes = when (tone) {
            StatusTone.OK -> R.color.ok
            StatusTone.DANGER -> R.color.danger
            StatusTone.NEUTRAL -> R.color.ink_dim
        }
        binding.status.setTextColor(ContextCompat.getColor(this, colorRes))
    }

    private fun ensureLocationPermissions() {
        val needed = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_CALL_LOG,
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
        setStatus(getString(R.string.monitoring_on), StatusTone.OK)
        binding.pairButton.isEnabled = false
    }
}
