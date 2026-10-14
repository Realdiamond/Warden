// Community feed (M7): checked tips from people nearby, Warden team notices and official
// broadcasts for the area on the map. Anyone can send a tip; Warden reads it first and shows
// only the area, never where it was sent from.

import { type CommunityPost, distanceMeters, MAX_TIP_LENGTH, MIN_TIP_LENGTH } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, Icon, ModalHeader, Note } from "../components/ui.tsx";
import { describeDistance, minutesAgo } from "../lib/alerts.ts";
import { feedArea } from "../lib/geo.ts";
import { type Language, strings } from "../lib/i18n.ts";
import type { DataSource } from "../lib/source.ts";
import { COLORS } from "../lib/ui.ts";

export function CommunityScreen({
  source,
  around: start,
  language,
  onClose,
}: {
  source: DataSource;
  around: { lat: number; lng: number };
  language: Language;
  onClose: () => void;
}) {
  const t = strings(language);
  // Fixed when the screen opens; the map behind it may keep moving.
  const [around] = useState(start);
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tip, setTip] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setPosts(await source.communityFeed(feedArea(around)));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [source, around]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    setSending(true);
    setMessage(null);
    try {
      const problem = await source.sendTip({ body: tip.trim(), location: around });
      if (problem) setMessage(problem);
      else {
        setTip("");
        setMessage(t.tipSent);
      }
    } catch {
      setMessage("No connection. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const flag = async (post: CommunityPost) => {
    const ok = await source.flagPost(post.id).catch(() => false);
    if (ok) setFlagged((current) => new Set(current).add(post.id));
  };

  const now = new Date();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="height">
      <ModalHeader title={t.community} onClose={onClose} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>{t.communityHelp}</Text>
        {posts === null && !failed && <ActivityIndicator color={COLORS.primary} />}
        {failed && <Note tone="warning">Could not load the feed. Check your connection.</Note>}
        {posts?.length === 0 && <Text style={styles.help}>{t.noPosts}</Text>}
        {posts?.map((post) => (
          <View key={post.id} style={[styles.post, post.kind === "broadcast" && styles.official]}>
            <View style={styles.postHead}>
              <Icon
                name={
                  post.kind === "broadcast"
                    ? "bullhorn"
                    : post.kind === "notice"
                      ? "shield-check"
                      : "account-voice"
                }
                color={COLORS.primary}
                size={18}
              />
              <Text style={styles.source}>
                {post.kind === "tip" ? t.anonymousTip : (post.source ?? t.wardenTeam)}
              </Text>
            </View>
            <Text style={styles.text}>{post.body}</Text>
            <Text style={styles.help}>
              {[
                post.areaLabel,
                describeDistance(distanceMeters(around, post.center), language),
                minutesAgo(post.publishedAt, now, language),
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {post.kind !== "broadcast" &&
              (flagged.has(post.id) ? (
                <Text style={styles.help}>{t.flagged}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void flag(post)}
                  style={styles.flag}
                >
                  <Text style={styles.flagText}>{t.flag}</Text>
                </Pressable>
              ))}
          </View>
        ))}

        <Text style={styles.section}>{t.shareTip}</Text>
        <TextInput
          style={styles.input}
          value={tip}
          onChangeText={(value) => setTip(value.slice(0, MAX_TIP_LENGTH))}
          placeholder={t.tipPlaceholder}
          placeholderTextColor={COLORS.muted}
          multiline
          accessibilityLabel={t.shareTip}
        />
        <Text style={styles.help}>{t.tipRules}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
        <Button
          label={t.sendTip}
          variant="primary"
          icon="send"
          disabled={sending || tip.trim().length < MIN_TIP_LENGTH}
          onPress={() => void send()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  help: { color: COLORS.muted, fontSize: 13 },
  section: { fontSize: 18, fontWeight: "700", color: COLORS.text, marginTop: 8 },
  post: {
    padding: 14,
    gap: 6,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  official: { borderColor: COLORS.primary },
  postHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  source: { fontWeight: "700", color: COLORS.text },
  text: { fontSize: 16, color: COLORS.text },
  flag: { alignSelf: "flex-start", paddingVertical: 6 },
  flagText: { color: COLORS.muted, textDecorationLine: "underline" },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
    textAlignVertical: "top",
  },
  message: { color: COLORS.text, fontWeight: "600" },
});
