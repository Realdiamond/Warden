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

// WARDEN_API_URL is baked into a build. Leave it empty to ship a build that starts in demo mode;
// testers can still point the app at a server from Settings.
const config: ExpoConfig = {
  name: "Warden",
  slug: "warden",
  scheme: "warden",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  android: {
    package: "ng.warden.app",
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
    mapStyleUrl: process.env.WARDEN_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty",
  },
};

export default withAbiSplits(config);
