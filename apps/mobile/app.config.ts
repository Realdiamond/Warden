import type { ExpoConfig } from "expo/config";

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
      },
    ],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#0F5C4D" }],
    "expo-background-task",
  ],
  extra: {
    apiUrl: process.env.WARDEN_API_URL ?? "",
    mapStyleUrl: process.env.WARDEN_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty",
  },
};

export default config;
