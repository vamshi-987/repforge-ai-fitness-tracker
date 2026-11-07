import { session } from '@/auth/session';

import type {
  CommentPage,
  FeedPage,
  FeedWorkout,
  FollowRequest,
  LikeState,
  Relation,
  UserProfile,
  UserResult,
  WorkoutComment,
} from './types';

const page = (cursor: string | null) => (cursor ? `?cursor=${cursor}` : '');

export function getFeed(cursor: string | null = null): Promise<FeedPage> {
  return session.request<FeedPage>(`/feed${page(cursor)}`);
}

export function getFeedWorkout(id: string): Promise<FeedWorkout> {
  return session.request<FeedWorkout>(`/feed/workouts/${id}`);
}

export function searchUsers(query: string): Promise<{ items: UserResult[] }> {
  return session.request(`/users/search?${new URLSearchParams({ q: query })}`);
}

export function getUser(username: string): Promise<UserProfile> {
  return session.request<UserProfile>(`/users/${encodeURIComponent(username)}`);
}

export function getUserWorkouts(username: string, cursor: string | null = null): Promise<FeedPage> {
  return session.request<FeedPage>(
    `/users/${encodeURIComponent(username)}/workouts${page(cursor)}`,
  );
}

export function follow(userId: string): Promise<{ relation: Relation }> {
  return session.request(`/users/${userId}/follow`, { method: 'POST' });
}

export function unfollow(userId: string): Promise<void> {
  return session.request<void>(`/users/${userId}/follow`, { method: 'DELETE' });
}

export function getFollowRequests(): Promise<{ items: FollowRequest[] }> {
  return session.request('/follow-requests');
}

export function acceptFollowRequest(userId: string): Promise<void> {
  return session.request<void>(`/follow-requests/${userId}/accept`, { method: 'POST' });
}

export function removeFollower(userId: string): Promise<void> {
  return session.request<void>(`/followers/${userId}`, { method: 'DELETE' });
}

export function likeWorkout(id: string): Promise<LikeState> {
  return session.request<LikeState>(`/workouts/${id}/like`, { method: 'POST' });
}

export function unlikeWorkout(id: string): Promise<LikeState> {
  return session.request<LikeState>(`/workouts/${id}/like`, { method: 'DELETE' });
}

export function getComments(workoutId: string): Promise<CommentPage> {
  return session.request<CommentPage>(`/workouts/${workoutId}/comments`);
}

export function addComment(workoutId: string, body: string): Promise<WorkoutComment> {
  return session.request<WorkoutComment>(`/workouts/${workoutId}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export function deleteComment(workoutId: string, commentId: string): Promise<void> {
  return session.request<void>(`/workouts/${workoutId}/comments/${commentId}`, {
    method: 'DELETE',
  });
}

export function registerPushToken(expoToken: string, platform: 'ios' | 'android'): Promise<void> {
  return session.request<void>('/push/tokens', {
    method: 'POST',
    body: { expo_token: expoToken, platform },
  });
}

export function removePushToken(expoToken: string): Promise<void> {
  return session.request<void>(`/push/tokens?${new URLSearchParams({ token: expoToken })}`, {
    method: 'DELETE',
  });
}
