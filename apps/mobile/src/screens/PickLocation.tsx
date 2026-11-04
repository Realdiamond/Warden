import { Camera, Map as MapView } from "@maplibre/maplibre-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { DEFAULT_CENTER } from "../components/IncidentMap.tsx";
import { Text } from "../components/text.tsx";
import { useMapStyle, useStyles, useTheme } from "../components/theme.tsx";
import { Button, Icon } from "../components/ui.tsx";
import type { Palette } from "../lib/theme.ts";

interface Props {
  /** Not used any more: the map follows the day or night theme. Kept so callers still fit. */
  styleUrl?: string;
  start: { lat: number; lng: number } | null;
  onPick: (point: { lat: number; lng: number }) => void;
  /** The line above the button; defaults to the wording for a report. */
  hint?: string;
  /** The button's words; defaults to "Use this place". */
  confirmLabel?: string;
}

/** Move the map until the pin sits where the incident happened. */
export function PickLocation({ start, onPick, hint, confirmLabel }: Props) {
  const c = useTheme();
  const styles = useStyles(makeStyles);
  const mapStyle = useMapStyle();
  const initial: [number, number] = start ? [start.lng, start.lat] : DEFAULT_CENTER;
  const [center, setCenter] = useState<[number, number]>(initial);

  return (
    <View style={styles.wrap}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle}
        logo={false}
        onRegionIsChanging={(event) => setCenter(event.nativeEvent.center)}
        onRegionDidChange={(event) => setCenter(event.nativeEvent.center)}
      >
        <Camera initialViewState={{ center: initial, zoom: 15 }} />
      </MapView>
      <View pointerEvents="none" style={styles.pinWrap}>
        <Icon name="map-marker" size={52} color={c.danger} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.hint}>{hint ?? "Move the map so the pin is where it happened."}</Text>
        <Button
          label={confirmLabel ?? "Use this place"}
          variant="primary"
          icon="check-circle"
          large
          onPress={() => onPick({ lat: center[1], lng: center[0] })}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, backgroundColor: c.background },
    pinWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      paddingBottom: 52,
    },
    footer: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 24,
      gap: 10,
      padding: 14,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: c.name === "dark" ? 1 : 0,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    hint: { color: c.text, textAlign: "center", fontSize: 15, lineHeight: 21 },
  });
