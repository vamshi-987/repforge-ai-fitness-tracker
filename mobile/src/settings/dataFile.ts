import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Hand a file to the phone's share sheet (save to Files, email, and so on). */
export async function shareTextFile(name: string, text: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}
