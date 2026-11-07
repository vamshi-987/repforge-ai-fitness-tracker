import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Claude scales larger images down to this anyway; sending less is faster and cheaper.
const MAX_EDGE = 1568;

/** A JPEG small enough to upload quickly, whatever the camera produced (HEIC included). */
export async function prepareFoodPhoto(asset: {
  uri: string;
  width: number;
  height: number;
}): Promise<string> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return saved.uri;
}
