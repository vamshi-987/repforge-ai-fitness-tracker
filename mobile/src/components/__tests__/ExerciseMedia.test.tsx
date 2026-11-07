import { render, screen } from '@testing-library/react-native';

import { ExerciseMedia } from '../ExerciseMedia';

jest.mock('expo-video', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const player = { loop: false, muted: false, play: jest.fn() };
  return {
    __player: player,
    useVideoPlayer: jest.fn((_source: string, setup?: (p: typeof player) => void) => {
      setup?.(player);
      return player;
    }),
    VideoView: (props: object) => <View testID="video-view" {...props} />,
  };
});

const video = jest.requireMock<{
  __player: { loop: boolean; muted: boolean; play: jest.Mock };
  useVideoPlayer: jest.Mock;
}>('expo-video');

describe('ExerciseMedia', () => {
  it('falls back to a large front-and-back body map without a video', async () => {
    await render(
      <ExerciseMedia videoUrl={null} primary={['chest']} secondary={['front_delts', 'triceps']} />,
    );

    expect(screen.getByTestId('exercise-media-bodymap')).toBeOnTheScreen();
    expect(screen.queryByTestId('video-view')).toBeNull();
    expect(
      screen.getByLabelText('Primary: Chest. Secondary: Front Delts, Triceps.'),
    ).toBeOnTheScreen();
    expect(video.useVideoPlayer).not.toHaveBeenCalled();
  });

  it('loops the video muted with a corner map on the right figure', async () => {
    await render(
      <ExerciseMedia
        videoUrl="https://cdn.example.com/lat-pulldown.mp4"
        primary={['lats']}
        secondary={['biceps']}
      />,
    );

    expect(screen.getByTestId('video-view')).toBeOnTheScreen();
    expect(video.useVideoPlayer).toHaveBeenCalledWith(
      'https://cdn.example.com/lat-pulldown.mp4',
      expect.any(Function),
    );
    expect(video.__player).toMatchObject({ loop: true, muted: true });
    expect(video.__player.play).toHaveBeenCalled();
    expect(screen.getByTestId('exercise-media-corner-map-back')).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-media-corner-map-front')).toBeNull();
  });
});
