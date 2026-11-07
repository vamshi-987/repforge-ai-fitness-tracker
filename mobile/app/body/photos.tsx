import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { createPhoto, deletePhoto, listPhotos, presignPhoto, uploadFile } from '@/api/body';
import type { PhotoPose, UploadContentType } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useTheme } from '@/theme/useTheme';

const PHOTOS_KEY = ['progress-photos'] as const;
const POSES: { value: PhotoPose; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
];

function contentType(mime: string | null | undefined): UploadContentType {
  return mime === 'image/png' || mime === 'image/heic' ? mime : 'image/jpeg';
}

/** Upload a picked image straight to storage, then record it. Needs a connection. */
export async function addPhoto(asset: ImagePicker.ImagePickerAsset, pose: PhotoPose) {
  const upload = await presignPhoto(contentType(asset.mimeType));
  await uploadFile(upload, asset.uri);
  return createPhoto({
    object_key: upload.object_key,
    taken_at: new Date().toISOString(),
    pose,
  });
}

/** Progress photos, private to the user. */
export default function ProgressPhotosScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const photos = useQuery({ queryKey: PHOTOS_KEY, queryFn: () => listPhotos() });
  const [pose, setPose] = useState<PhotoPose>('front');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(source: 'camera' | 'library') {
    setError(null);
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(`Allow ${source === 'camera' ? 'camera' : 'photo library'} access in Settings.`);
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setBusy(true);
    try {
      await addPhoto(asset, pose);
      await queryClient.invalidateQueries({ queryKey: PHOTOS_KEY });
    } catch {
      setError("Couldn't upload the photo. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const remove = (id: string) =>
    Alert.alert('Delete photo?', 'It will be removed from your progress photos.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deletePhoto(id).then(() => queryClient.invalidateQueries({ queryKey: PHOTOS_KEY })),
      },
    ]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {POSES.map((p) => (
          <Chip
            key={p.value}
            label={p.label}
            accessibilityLabel={`Pose: ${p.label}`}
            selected={pose === p.value}
            onPress={() => setPose(p.value)}
          />
        ))}
      </View>
      <Button label="Take photo" loading={busy} onPress={() => void pick('camera')} />
      <Button
        label="Choose from library"
        variant="secondary"
        disabled={busy}
        onPress={() => void pick('library')}
      />
      {error ? <Text style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}

      {photos.isError ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Photos need a connection.
        </Text>
      ) : photos.data?.items.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          No photos yet. Same light, same pose, every few weeks shows change best.
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {photos.data?.items.map((photo) => {
            const date = new Date(photo.taken_at).toLocaleDateString([], {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            return (
              <Pressable
                key={photo.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${photo.pose ?? 'Photo'}, ${date}. Long press to delete.`}
                onLongPress={() => remove(photo.id)}
                style={{ width: '31%' }}
              >
                <Image
                  source={{ uri: photo.url }}
                  style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md }}
                />
                <Text style={[typography.caption, { color: colors.textMuted }]}>{date}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
