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
  View,
} from "react-native";
import { Text, TextInput } from "../components/text.tsx";
import { useStyles, useTheme } from "../components/theme.tsx";
import { Button, IconTile, ModalHeader, Note, SectionLabel, type Tone } from "../components/ui.tsx";
import { describeDistance, minutesAgo } from "../lib/alerts.ts";
import { feedArea } from "../lib/geo.ts";
import { type Language, strings } from "../lib/i18n.ts";
import type { DataSource } from "../lib/source.ts";
import { MONO, type Palette } from "../lib/theme.ts";

const POST_LOOK: Record<CommunityPost["kind"], { icon: string; tone: Tone }> = {
  broadcast: { icon: "bullhorn", tone: "responder" },
  notice: { icon: "shield-check", tone: "primary" },
  tip: { icon: "account-voice", tone: "neutral" },
};

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
  const c = useTheme();
  const styles = useStyles(makeStyles);
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
        {posts === null && !failed && <ActivityIndicator color={c.primary} />}
        {failed && <Note tone="warning">Could not load the feed. Check your connection.</Note>}
        {posts?.length === 0 && <Text style={styles.help}>{t.noPosts}</Text>}
        {posts?.map((post) => (
          <View key={post.id} style={[styles.post, post.kind === "broadcast" && styles.official]}>
            <View style={styles.postHead}>
              <IconTile
                icon={POST_LOOK[post.kind].icon}
                tone={POST_LOOK[post.kind].tone}
                size={32}
                round
              />
              <Text style={styles.source}>
                {post.kind === "tip" ? t.anonymousTip : (post.source ?? t.wardenTeam)}
              </Text>
            </View>
            <Text style={styles.text}>{post.body}</Text>
            <Text style={styles.meta}>
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
                  style={({ pressed }) => [styles.flag, pressed && styles.pressed]}
                >
                  <Text style={styles.flagText}>{t.flag}</Text>
                </Pressable>
              ))}
          </View>
        ))}

        <View style={styles.compose}>
          <SectionLabel>{t.shareTip}</SectionLabel>
          <TextInput
            style={styles.input}
            value={tip}
            onChangeText={(value) => setTip(value.slice(0, MAX_TIP_LENGTH))}
            placeholder={t.tipPlaceholder}
            multiline
            accessibilityLabel={t.shareTip}
          />
          <Text style={styles.counter}>
            {tip.length}/{MAX_TIP_LENGTH}
          </Text>
          <Text style={styles.help}>{t.tipRules}</Text>
        </View>
        {message && <Text style={styles.message}>{message}</Text>}
        <Button
          label={t.sendTip}
          variant="primary"
          icon="send"
          large
          disabled={sending || tip.trim().length < MIN_TIP_LENGTH}
          onPress={() => void send()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    body: { padding: 16, gap: 12, paddingBottom: 48 },
    help: { color: c.muted, fontSize: 14, lineHeight: 20 },
    meta: { color: c.muted, fontSize: 13.5 },
    post: {
      padding: 16,
      gap: 8,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    official: { borderColor: c.responder, borderWidth: 2 },
    postHead: { flexDirection: "row", alignItems: "center", gap: 10 },
    source: { flex: 1, fontWeight: "700", fontSize: 15, color: c.text },
    text: { fontSize: 17, lineHeight: 24, color: c.text },
    flag: {
      alignSelf: "flex-start",
      minHeight: 44,
      justifyContent: "center",
      paddingRight: 12,
    },
    pressed: { opacity: 0.6 },
    flagText: { color: c.primary, fontWeight: "700", fontSize: 14 },
    compose: { gap: 8, marginTop: 12 },
    input: {
      minHeight: 104,
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 14,
      padding: 14,
      fontSize: 17,
      color: c.text,
      backgroundColor: c.surface,
      textAlignVertical: "top",
    },
    counter: { alignSelf: "flex-end", fontFamily: MONO, fontSize: 13, color: c.muted },
    message: { color: c.text, fontWeight: "700", fontSize: 15 },
  });
