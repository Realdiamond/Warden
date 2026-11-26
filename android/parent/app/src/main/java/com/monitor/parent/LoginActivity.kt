package com.monitor.parent

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.monitor.parent.databinding.ActivityLoginBinding
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var store: Store
    private var signup = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        if (store.isLoggedIn) {
            goToDevices()
            return
        }
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.baseUrl.setText(store.baseUrl)

        binding.toggle.setOnClickListener {
            signup = !signup
            binding.submit.text = getString(if (signup) R.string.create_account else R.string.sign_in)
            binding.toggle.text = getString(if (signup) R.string.have_account else R.string.no_account)
        }
        binding.submit.setOnClickListener { submit() }
    }

    private fun submit() {
        val email = binding.email.text.toString().trim()
        val password = binding.password.text.toString()
        if (email.isEmpty() || password.length < 8) {
            Toast.makeText(this, R.string.bad_creds, Toast.LENGTH_SHORT).show()
            return
        }
        store.baseUrl = binding.baseUrl.text.toString().trim()
        binding.submit.isEnabled = false
        binding.status.text = ""

        lifecycleScope.launch {
            when (val result = Api(store.baseUrl).authenticate(email, password, signup)) {
                is AuthResult.Success -> {
                    store.token = result.token
                    goToDevices()
                }
                is AuthResult.Failure -> {
                    binding.submit.isEnabled = true
                    binding.status.text = getString(R.string.sign_in_failed, result.error)
                }
            }
        }
    }

    private fun goToDevices() {
        startActivity(Intent(this, DevicesActivity::class.java))
        finish()
    }
}
