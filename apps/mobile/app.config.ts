import type { ExpoConfig } from "expo/config";
import { type ConfigPlugin, withAppBuildGradle } from "expo/config-plugins";

// Real phones use one of two processor families. Building one APK per family instead of one
// for both roughly halves the download. Play Store bundles (.aab) ignore this and split anyway.
const ABI_SPLITS = `
// Added by app.config.ts (withAbiSplits): one APK per phone processor family.
android {
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk false
        }
    }
}
`;

const withAbiSplits: ConfigPlugin = (expoConfig) =>
  withAppBuildGradle(expoConfig, (gradle) => {
    if (!gradle.modResults.contents.includes("withAbiSplits")) {
      gradle.modResults.contents += ABI_SPLITS;
    }
    return gradle;
  });

// Play Store builds are signed with Warden's upload key, which the release workflow provides
// through WARDEN_UPLOAD_* settings (docs/play-store.md). Without them, release builds keep the
// development key, as the test APKs always have. Google Play rejects the development key.
const UPLOAD_SIGNING = `
// Added by app.config.ts (withUploadSigning): sign with the Play upload key when given one.
if (System.getenv("WARDEN_UPLOAD_STORE_FILE")) {
    android {
        signingConfigs {
            upload {
                storeFile file(System.getenv("WARDEN_UPLOAD_STORE_FILE"))
                storePassword System.getenv("WARDEN_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("WARDEN_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("WARDEN_UPLOAD_STORE_PASSWORD")
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.upload
            }
        }
    }
}
`;

const withUploadSigning: ConfigPlugin = (expoConfig) =>
  withAppBuildGradle(expoConfig, (gradle) => {
    if (!gradle.modResults.contents.includes("withUploadSigning")) {
      gradle.modResults.contents += UPLOAD_SIGNING;
    }
    return gradle;
  });

// WARDEN_API_URL is baked into a build. Leave it empty to ship a build that starts in demo mode;
// testers can still point the app at a server from Settings.
const config: ExpoConfig = {
  name: "Warden",
  slug: "warden",
  scheme: "warden",
  // Play Store releases set the version people see (WARDEN_VERSION_NAME); test builds stay 0.1.0.
  version: process.env.WARDEN_VERSION_NAME ?? "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  android: {
    package: "ng.warden.app",
    // Contacts, places, PINs and trip tokens "stay on this phone": keep them out of Android's
    // automatic cloud backup too (security review, November 2026).
    allowBackup: false,
    versionCode: Number(process.env.WARDEN_VERSION_CODE ?? 1),
    adaptiveIcon: {
      backgroundColor: "#0F5C4D",
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "POST_NOTIFICATIONS"],
    blockedPermissions: ["ACCESS_BACKGROUND_LOCATION"],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "@maplibre/maplibre-react-native",
    // Atkinson Hyperlegible (M10), bundled into the build so text never waits for a download.
    [
      "expo-font",
      {
        fonts: [
          "./assets/fonts/AtkinsonHyperlegibleNext_400Regular.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_500Medium.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_700Bold.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_800ExtraBold.ttf",
          "./assets/fonts/AtkinsonHyperlegibleMono_500Medium.ttf",
          "./assets/fonts/AtkinsonHyperlegibleMono_700Bold.ttf",
        ],
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Warden uses your location to show nearby safety information and to place your reports.",
        isAndroidBackgroundLocationEnabled: false,
        // Trips and SOS share location through a visible foreground service, which needs only
        // "while using the app" permission.
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: "./assets/notification-icon.png",
      },
    ],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#0F5C4D" }],
    "expo-background-task",
    [
      "expo-audio",
      {
        microphonePermission:
          "Warden uses the microphone for voice notes and, if you turn it on, to record sound during an SOS.",
        // SOS sound keeps recording with the screen off, under Android's visible notification.
        enableBackgroundRecording: true,
        enableBackgroundPlayback: false,
      },
    ],
    [
      "expo-image-picker",
      {
        cameraPermission: "Warden uses the camera when you add a photo or video to a report.",
        microphonePermission: "Warden uses the microphone when you record a video for a report.",
        photosPermission: "Warden opens your photos when you add one to a report.",
      },
    ],
  ],
  extra: {
    apiUrl: process.env.WARDEN_API_URL ?? "",
    // Public half of the server's broadcast signing key (from gen-keys). Not secret. During a
    // key change this is a list such as "s1:<key>,s2:<key>" (docs/deploy.md).
    broadcastPublicKey: process.env.WARDEN_BROADCAST_PUBLIC_KEY ?? "",
    // A calm grey map by day so incident colours stand out, and a dark one for night mode.
    mapStyleUrl:
      process.env.WARDEN_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron",
    mapStyleDarkUrl:
      process.env.WARDEN_MAP_STYLE_DARK_URL ?? "https://tiles.openfreemap.org/styles/dark",
  },
};

export default withUploadSigning(withAbiSplits(config));
