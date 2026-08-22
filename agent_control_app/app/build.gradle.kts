plugins {
    id("com.android.application")
}

android {
    namespace = "cc.odyliao.pikminagentcontrol"
    compileSdk = 35

    defaultConfig {
        applicationId = "cc.odyliao.pikminagentcontrol"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "1.3.1"
    }

    val releaseKeystore = System.getenv("AGENT_CONTROL_KEYSTORE_PATH")
    val releaseStorePassword = System.getenv("AGENT_CONTROL_KEYSTORE_PASSWORD")
    val releaseKeyAlias = System.getenv("AGENT_CONTROL_KEY_ALIAS")
    val releaseKeyPassword = System.getenv("AGENT_CONTROL_KEY_PASSWORD")

    if (!releaseKeystore.isNullOrBlank()) {
        signingConfigs.create("agentControlRelease") {
            storeFile = file(releaseKeystore)
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (!releaseKeystore.isNullOrBlank()) {
                signingConfigs.getByName("agentControlRelease")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
