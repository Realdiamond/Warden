plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.monitor.child"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.monitor.child"
        minSdk = 26
        targetSdk = 34
        versionCode = 10
        versionName = "0.3.3"
    }

    // A single stable signing key (committed under android/signing) so every build — local and CI —
    // is signed identically. Without this, each build machine uses its own throwaway debug key and
    // Android refuses to install the update over a differently-signed copy ("App not installed").
    signingConfigs {
        create("shared") {
            storeFile = file("../../signing/monitor-signing.jks")
            storePassword = "monitor-dev"
            keyAlias = "monitor"
            keyPassword = "monitor-dev"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            signingConfig = signingConfigs.getByName("shared")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
