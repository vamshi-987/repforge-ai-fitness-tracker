import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { BodyMap } from './BodyMap';

interface ExerciseMediaProps {
  videoUrl: string | null;
  primary: readonly string[];
  secondary: readonly string[];
  gender?: 'male' | 'female';
}

/**
 * The "red muscle" demo (CLAUDE.md §1, option D). With a video, it loops muted with a small
 * body map in the corner; without one, a large front-and-back body map stands in. Pointing
 * `media_video_url` at licensed loops later needs no code change here.
 */
export function ExerciseMedia({ videoUrl, primary, secondary, gender }: ExerciseMediaProps) {
  if (videoUrl) {
    return (
      <ExerciseVideo videoUrl={videoUrl} primary={primary} secondary={secondary} gender={gender} />
    );
  }
  return (
    <View testID="exercise-media-bodymap" style={styles.fallback}>
      <BodyMap primary={primary} secondary={secondary} gender={gender} scale={0.75} />
    </View>
  );
}

function ExerciseVideo({
  videoUrl,
  primary,
  secondary,
  gender,
}: ExerciseMediaProps & { videoUrl: string }) {
  const { colors, radius, spacing } = useTheme();
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <View
      testID="exercise-media-video"
      style={[styles.video, { backgroundColor: colors.surface, borderRadius: radius.lg }]}
    >
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="contain"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.corner,
          {
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            padding: spacing.xs,
            right: spacing.sm,
            bottom: spacing.sm,
          },
        ]}
      >
        <BodyMap
          primary={primary}
          secondary={secondary}
          gender={gender}
          views="auto"
          scale={0.22}
          testID="exercise-media-corner-map"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', paddingVertical: 8 },
  video: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  corner: { position: 'absolute', opacity: 0.95 },
});
