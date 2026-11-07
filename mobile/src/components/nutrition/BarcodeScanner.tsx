import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useTheme } from '@/theme/useTheme';

interface BarcodeScannerProps {
  /** Scanning pauses until this settles. */
  onCode: (code: string) => Promise<void>;
}

/** The camera, and a field for a code it can't read (or a device without a camera). */
export function BarcodeScanner({ onCode }: BarcodeScannerProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  // The camera reports the same code many times a second.
  const busy = useRef(false);

  async function handle(code: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      await onCode(code);
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      {permission?.granted ? (
        <CameraView
          testID="barcode-camera"
          style={[styles.camera, { borderRadius: radius.lg }]}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
          onBarcodeScanned={({ data }) => void handle(data)}
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.body, { color: colors.textMuted }]}>
            Allow the camera to scan food barcodes.
          </Text>
          <Button
            label="Allow camera"
            variant="secondary"
            onPress={() => void requestPermission()}
          />
        </View>
      )}
      <TextField
        label="Or type the barcode"
        value={typed}
        onChangeText={setTyped}
        keyboardType="number-pad"
        maxLength={14}
        returnKeyType="search"
        onSubmitEditing={() => void handle(typed.trim())}
      />
      <Button
        label="Look up"
        variant="secondary"
        disabled={typed.trim().length < 8}
        onPress={() => void handle(typed.trim())}
      />
    </View>
  );
}

const styles = StyleSheet.create({ camera: { height: 260, overflow: 'hidden' } });
