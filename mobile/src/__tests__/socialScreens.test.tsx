import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ApiError } from '@/api/client';
import type { FeedWorkout, UserProfile, WorkoutComment } from '@/api/types';
import { Feed } from '@/components/social/Feed';
import { ShareWorkout } from '@/components/social/ShareWorkout';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';
import type { SavedWorkout } from '@/workout/history';

import FollowRequestsScreen from '../../app/social/requests';
import FindPeopleScreen from '../../app/social/search';
import UserScreen from '../../app/social/user/[username]';
import SharedWorkoutScreen from '../../app/social/workout/[id]';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('@/api/social', () => ({
  acceptFollowRequest: jest.fn(),
  addComment: jest.fn(),
  deleteComment: jest.fn(),
  follow: jest.fn(),
  getComments: jest.fn(),
  getFeed: jest.fn(),
  getFeedWorkout: jest.fn(),
  getFollowRequests: jest.fn(),
  getUser: jest.fn(),
  getUserWorkouts: jest.fn(),
  likeWorkout: jest.fn(),
  removeFollower: jest.fn(),
  searchUsers: jest.fn(),
  unfollow: jest.fn(),
  unlikeWorkout: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => 'file://card.png'),
}));

const expoRouter = jest.requireMock<{
  router: { push: jest.Mock };
  useLocalSearchParams: jest.Mock;
}>('expo-router');
const { router } = expoRouter;
const api = jest.requireMock<Record<string, jest.Mock>>('@/api/social') as Record<
  | 'acceptFollowRequest'
  | 'addComment'
  | 'deleteComment'
  | 'follow'
  | 'getComments'
  | 'getFeed'
  | 'getFeedWorkout'
  | 'getFollowRequests'
  | 'getUser'
  | 'getUserWorkouts'
  | 'likeWorkout'
  | 'removeFollower'
  | 'searchUsers'
  | 'unfollow'
  | 'unlikeWorkout',
  jest.Mock
>;
const sharing = jest.requireMock<{ isAvailableAsync: jest.Mock; shareAsync: jest.Mock }>(
  'expo-sharing',
);

const ANA = { id: 'ana-id', username: 'ana', display_name: 'Ana', avatar_url: null };
const WORKOUT: FeedWorkout = {
  id: 'w1',
  user: ANA,
  title: 'Push day',
  notes: 'Felt strong.',
  started_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  ended_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  total_volume_kg: 3200,
  total_sets: 18,
  visibility: 'public',
  exercises: [{ name: 'Bench Press', sets: 4 }],
  like_count: 2,
  comment_count: 1,
  liked: false,
};
const PROFILE: UserProfile = {
  ...ANA,
  is_private: false,
  followers: 3,
  following: 5,
  relation: 'none',
  can_view_workouts: true,
};
const COMMENT: WorkoutComment = {
  id: 'c1',
  workout_id: 'w1',
  user: { ...ANA, id: 'ben-id', username: 'ben', display_name: 'Ben' },
  body: 'Nice set!',
  created_at: new Date().toISOString(),
  can_delete: true,
};
const OFFLINE = new ApiError(0, 'network_error', 'Offline');
const NOW = Date.now();

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  expoRouter.useLocalSearchParams.mockReturnValue({});
  api.getFeed?.mockResolvedValue({ items: [WORKOUT], next_cursor: null });
  api.getFeedWorkout?.mockResolvedValue(WORKOUT);
  api.getComments?.mockResolvedValue({ items: [COMMENT], next_cursor: null });
  api.getUser?.mockResolvedValue(PROFILE);
  api.getUserWorkouts?.mockResolvedValue({ items: [WORKOUT], next_cursor: null });
  sharing.isAvailableAsync.mockResolvedValue(true);
});

describe('The feed', () => {
  it('shows who did what', async () => {
    await show(<Feed now={NOW} />);

    expect(await screen.findByText('Push day')).toBeOnTheScreen();
    expect(screen.getByText('Ana')).toBeOnTheScreen();
    expect(screen.getByText('2 h ago')).toBeOnTheScreen();
    expect(screen.getByText('Bench Press × 4')).toBeOnTheScreen();
    expect(screen.getByText(/18 sets/)).toBeOnTheScreen();
  });

  it('opens the workout and the person', async () => {
    await show(<Feed now={NOW} />);

    await fireEvent.press(await screen.findByLabelText('Open Push day'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/social/workout/[id]',
      params: { id: 'w1' },
    });

    await fireEvent.press(screen.getByLabelText('Open Ana’s profile'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/social/user/[username]',
      params: { username: 'ana' },
    });
  });

  it('counts a like at once', async () => {
    api.likeWorkout?.mockResolvedValue({ liked: true, like_count: 3 });
    await show(<Feed now={NOW} />);

    await fireEvent.press(await screen.findByLabelText('Like Push day, 2 likes'));

    expect(await screen.findByLabelText('Unlike Push day, 3 likes')).toBeOnTheScreen();
    expect(api.likeWorkout).toHaveBeenCalledWith('w1');
  });

  it('takes a like back when it fails', async () => {
    api.likeWorkout?.mockRejectedValue(OFFLINE);
    await show(<Feed now={NOW} />);

    await fireEvent.press(await screen.findByLabelText('Like Push day, 2 likes'));

    await waitFor(() => expect(api.likeWorkout).toHaveBeenCalled());
    expect(await screen.findByLabelText('Like Push day, 2 likes')).toBeOnTheScreen();
  });

  it('removes a like', async () => {
    api.getFeed?.mockResolvedValue({
      items: [{ ...WORKOUT, liked: true, like_count: 3 }],
      next_cursor: null,
    });
    api.unlikeWorkout?.mockResolvedValue({ liked: false, like_count: 2 });
    await show(<Feed now={NOW} />);

    await fireEvent.press(await screen.findByLabelText('Unlike Push day, 3 likes'));

    await waitFor(() => expect(api.unlikeWorkout).toHaveBeenCalledWith('w1'));
  });

  it('loads more', async () => {
    api.getFeed?.mockResolvedValueOnce({ items: [WORKOUT], next_cursor: 'next' });
    api.getFeed?.mockResolvedValueOnce({
      items: [{ ...WORKOUT, id: 'w2', title: 'Pull day' }],
      next_cursor: null,
    });
    await show(<Feed now={NOW} />);

    await fireEvent.press(await screen.findByLabelText('Show more'));

    expect(await screen.findByText('Pull day')).toBeOnTheScreen();
    expect(api.getFeed).toHaveBeenLastCalledWith('next');
    expect(screen.queryByLabelText('Show more')).toBeNull();
  });

  it('points an empty feed at finding people', async () => {
    api.getFeed?.mockResolvedValue({ items: [], next_cursor: null });
    await show(<Feed now={NOW} />);

    expect(await screen.findByText(/Follow people/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Find people'));
    expect(router.push).toHaveBeenCalledWith('/social/search');
  });

  it('says when it needs a connection', async () => {
    api.getFeed?.mockRejectedValue(OFFLINE);
    await show(<Feed now={NOW} />);

    expect(await screen.findByText('The feed needs a connection.')).toBeOnTheScreen();
  });
});

describe('A shared workout', () => {
  beforeEach(() => expoRouter.useLocalSearchParams.mockReturnValue({ id: 'w1' }));

  it('shows the notes and comments', async () => {
    await show(<SharedWorkoutScreen />);

    expect(await screen.findByText('Felt strong.')).toBeOnTheScreen();
    expect(await screen.findByText('Nice set!')).toBeOnTheScreen();
  });

  it('adds a comment', async () => {
    api.addComment?.mockResolvedValue(COMMENT);
    await show(<SharedWorkoutScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Add a comment'), ' Great! ');
    await fireEvent.press(screen.getByLabelText('Send'));

    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith('w1', 'Great!'));
    await waitFor(() => expect(screen.getByLabelText('Add a comment')).toHaveProp('value', ''));
  });

  it('keeps the text when sending fails', async () => {
    api.addComment?.mockRejectedValue(OFFLINE);
    await show(<SharedWorkoutScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Add a comment'), 'Great!');
    await fireEvent.press(screen.getByLabelText('Send'));

    expect(await screen.findByText(/couldn’t be sent/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Add a comment')).toHaveProp('value', 'Great!');
  });

  it('deletes a comment, and says if that fails', async () => {
    api.deleteComment?.mockRejectedValueOnce(OFFLINE);
    api.deleteComment?.mockResolvedValue(undefined);
    await show(<SharedWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Delete comment: Nice set!'));
    expect(await screen.findByText(/couldn’t be deleted/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Delete comment: Nice set!'));
    await waitFor(() => expect(api.deleteComment).toHaveBeenCalledTimes(2));
  });

  it('offers no delete on other people’s comments', async () => {
    api.getComments?.mockResolvedValue({
      items: [{ ...COMMENT, can_delete: false }],
      next_cursor: null,
    });
    await show(<SharedWorkoutScreen />);

    expect(await screen.findByText('Nice set!')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Delete comment: Nice set!')).toBeNull();
  });

  it('opens a commenter’s profile', async () => {
    await show(<SharedWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Open Ben’s profile'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/social/user/[username]',
      params: { username: 'ben' },
    });
  });

  it('explains a workout that can’t be seen', async () => {
    api.getFeedWorkout?.mockRejectedValue(new ApiError(404, 'not_found', 'No'));
    await show(<SharedWorkoutScreen />);

    expect(await screen.findByText(/isn’t available/)).toBeOnTheScreen();
  });
});

describe('A profile', () => {
  beforeEach(() => expoRouter.useLocalSearchParams.mockReturnValue({ username: 'ana' }));

  it('shows the person and their workouts', async () => {
    await show(<UserScreen />);

    expect(await screen.findByText('3 followers · 5 following')).toBeOnTheScreen();
    expect(await screen.findByText('Push day')).toBeOnTheScreen();
  });

  it('follows, then shows the new state', async () => {
    api.follow?.mockResolvedValue({ relation: 'following' });
    api.getUser?.mockResolvedValueOnce(PROFILE);
    api.getUser?.mockResolvedValue({ ...PROFILE, relation: 'following', followers: 4 });
    await show(<UserScreen />);

    await fireEvent.press(await screen.findByLabelText('Follow'));

    expect(await screen.findByLabelText('Following')).toBeOnTheScreen();
    expect(api.follow).toHaveBeenCalledWith('ana-id');
  });

  it('unfollows', async () => {
    api.unfollow?.mockResolvedValue(undefined);
    api.getUser?.mockResolvedValue({ ...PROFILE, relation: 'following' });
    await show(<UserScreen />);

    await fireEvent.press(await screen.findByLabelText('Following'));

    await waitFor(() => expect(api.unfollow).toHaveBeenCalledWith('ana-id'));
  });

  it('says when following fails', async () => {
    api.follow?.mockRejectedValue(OFFLINE);
    await show(<UserScreen />);

    await fireEvent.press(await screen.findByLabelText('Follow'));

    expect(await screen.findByText(/didn’t work/)).toBeOnTheScreen();
  });

  it('keeps a private profile’s workouts out of reach', async () => {
    api.getUser?.mockResolvedValue({ ...PROFILE, is_private: true, can_view_workouts: false });
    await show(<UserScreen />);

    expect(await screen.findByText(/This profile is private/)).toBeOnTheScreen();
    expect(api.getUserWorkouts).not.toHaveBeenCalled();
  });

  it('shows a waiting request', async () => {
    api.getUser?.mockResolvedValue({
      ...PROFILE,
      is_private: true,
      relation: 'requested',
      can_view_workouts: false,
    });
    await show(<UserScreen />);

    expect(await screen.findByLabelText('Requested')).toBeOnTheScreen();
  });

  it('has no follow button on your own', async () => {
    api.getUser?.mockResolvedValue({ ...PROFILE, relation: 'self' });
    api.getUserWorkouts?.mockResolvedValue({ items: [], next_cursor: null });
    await show(<UserScreen />);

    expect(await screen.findByText('No workouts to show.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Follow')).toBeNull();
  });

  it('loads more workouts', async () => {
    api.getUserWorkouts?.mockResolvedValueOnce({ items: [WORKOUT], next_cursor: 'next' });
    api.getUserWorkouts?.mockResolvedValueOnce({
      items: [{ ...WORKOUT, id: 'w2', title: 'Pull day' }],
      next_cursor: null,
    });
    await show(<UserScreen />);

    await fireEvent.press(await screen.findByLabelText('Show more'));

    expect(await screen.findByText('Pull day')).toBeOnTheScreen();
  });

  it('says when it can’t load', async () => {
    api.getUser?.mockRejectedValue(new ApiError(404, 'not_found', 'No'));
    await show(<UserScreen />);

    expect(await screen.findByText(/isn’t available/)).toBeOnTheScreen();
  });
});

describe('Finding people', () => {
  it('searches and opens a result', async () => {
    api.searchUsers?.mockResolvedValue({
      items: [
        { ...ANA, relation: 'none' },
        { ...ANA, id: 'x', username: 'anaya', display_name: 'Anaya', relation: 'following' },
      ],
    });
    await show(<FindPeopleScreen />);

    await fireEvent.changeText(screen.getByLabelText('Name or username'), 'ana');

    expect(await screen.findByText('@ana', {}, { timeout: 2000 })).toBeOnTheScreen();
    expect(screen.getByText('Following')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Open Ana’s profile'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/social/user/[username]',
      params: { username: 'ana' },
    });
  });

  it('says when nobody matches, or it can’t search', async () => {
    api.searchUsers?.mockResolvedValueOnce({ items: [] });
    await show(<FindPeopleScreen />);

    await fireEvent.changeText(screen.getByLabelText('Name or username'), 'zz');
    expect(await screen.findByText('Nobody found.', {}, { timeout: 2000 })).toBeOnTheScreen();

    api.searchUsers?.mockRejectedValueOnce(OFFLINE);
    await fireEvent.changeText(screen.getByLabelText('Name or username'), 'zzz');
    expect(await screen.findByText(/needs a connection/, {}, { timeout: 2000 })).toBeOnTheScreen();
  });
});

describe('Follow requests', () => {
  const REQUEST = { user: ANA, created_at: '' };

  it('accepts and declines', async () => {
    api.getFollowRequests?.mockResolvedValue({ items: [REQUEST] });
    api.acceptFollowRequest?.mockResolvedValue(undefined);
    api.removeFollower?.mockResolvedValue(undefined);
    await show(<FollowRequestsScreen />);

    await fireEvent.press(await screen.findByLabelText('Accept Ana'));
    await waitFor(() => expect(api.acceptFollowRequest).toHaveBeenCalledWith('ana-id'));

    await fireEvent.press(screen.getByLabelText('Decline Ana'));
    await waitFor(() => expect(api.removeFollower).toHaveBeenCalledWith('ana-id'));
  });

  it('says when an answer fails', async () => {
    api.getFollowRequests?.mockResolvedValue({ items: [REQUEST] });
    api.acceptFollowRequest?.mockRejectedValue(OFFLINE);
    await show(<FollowRequestsScreen />);

    await fireEvent.press(await screen.findByLabelText('Accept Ana'));

    expect(await screen.findByText(/didn’t work/)).toBeOnTheScreen();
  });

  it('says when there are none, or it can’t load', async () => {
    api.getFollowRequests?.mockResolvedValueOnce({ items: [] });
    const first = await show(<FollowRequestsScreen />);
    expect(await screen.findByText('No requests right now.')).toBeOnTheScreen();
    await first.unmount();

    api.getFollowRequests?.mockRejectedValueOnce(OFFLINE);
    await show(<FollowRequestsScreen />);
    expect(await screen.findByText(/need a connection/)).toBeOnTheScreen();
  });
});

describe('Sharing a workout', () => {
  const SAVED: SavedWorkout = {
    id: 'w',
    routineId: null,
    title: 'Leg day',
    notes: '',
    startedAt: NOW - 3_600_000,
    endedAt: NOW,
    visibility: 'public',
    volumeKg: 5000,
    setCount: 20,
    exercises: [],
  };

  it('previews the card and shares it as an image', async () => {
    await show(<ShareWorkout workout={SAVED} unit="kg" />);

    await fireEvent.press(screen.getByLabelText('Share workout'));
    expect(await screen.findByText('Leg day')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Share image'));

    await waitFor(() =>
      expect(sharing.shareAsync).toHaveBeenCalledWith('file://card.png', {
        mimeType: 'image/png',
        dialogTitle: 'Leg day',
      }),
    );
  });

  it('says when this device can’t share', async () => {
    sharing.isAvailableAsync.mockResolvedValue(false);
    await show(<ShareWorkout workout={SAVED} unit="kg" />);

    await fireEvent.press(screen.getByLabelText('Share workout'));
    await fireEvent.press(await screen.findByLabelText('Share image'));

    expect(await screen.findByText(/couldn’t be shared/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Close'));
  });
});
