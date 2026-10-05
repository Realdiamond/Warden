import { Camera, Map as MapView } from "@maplibre/maplibre-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DEFAULT_CENTER } from "../components/IncidentMap.tsx";
import { Button, Icon } from "../components/ui.tsx";
import { COLORS } from "../lib/ui.ts";

interface Props {
  styleUrl: string;
  start: { lat: number; lng: number } | null;
  onPick: (point: { lat: number; lng: number }) => void;
}

/** Move the map until the pin sits where the incident happened. */
export function PickLocation({ styleUrl, start, onPick }: Props) {
  const initial: [number, number] = start ? [start.lng, start.lat] : DEFAULT_CENTER;
  const [center, setCenter] = useState<[number, number]>(initial);

  return (
    <View style={styles.wrap}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={styleUrl}
        logo={false}
        onRegionIsChanging={(event) => setCenter(event.nativeEvent.center)}
        onRegionDidChange={(event) => setCenter(event.nativeEvent.center)}
      >
        <Camera initialViewState={{ center: initial, zoom: 15 }} />
      </MapView>
      <View pointerEvents="none" style={styles.pinWrap}>
        <Icon name="map-marker" size={48} color={COLORS.danger} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.hint}>Move the map so the pin is where it happened.</Text>
        <Button
          label="Use this place"
          variant="primary"
          icon="check-circle"
          onPress={() => onPick({ lat: center[1], lng: center[0] })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  pinWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 48,
  },
  footer: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    elevation: 6,
  },
  hint: { color: COLORS.text, textAlign: "center" },
});
