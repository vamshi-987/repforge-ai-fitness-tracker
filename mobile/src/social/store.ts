import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import * as socialApi from '@/api/social';

// Other people's data lives on the server, so these need a connection and say so when they
// fail, rather than waiting for one.
export const SOCIAL_KEY = ['social'] as const;
const online = { networkMode: 'always', retry: false, staleTime: 30_000 } as const;
const MIN_SEARCH_CHARS = 2;

export function useFeed() {
  return useInfiniteQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'feed'],
    queryFn: ({ pageParam }) => socialApi.getFeed(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useUserWorkouts(username: string, enabled: boolean) {
  return useInfiniteQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'user-workouts', username],
    queryFn: ({ pageParam }) => socialApi.getUserWorkouts(username, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
  });
}

export function useFeedWorkout(id: string) {
  return useQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'workout', id],
    queryFn: () => socialApi.getFeedWorkout(id),
  });
}

export function useComments(workoutId: string) {
  return useQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'comments', workoutId],
    queryFn: () => socialApi.getComments(workoutId),
  });
}

export function useUser(username: string) {
  return useQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'user', username],
    queryFn: () => socialApi.getUser(username),
  });
}

export function useUserSearch(query: string) {
  return useQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'search', query],
    queryFn: () => socialApi.searchUsers(query),
    enabled: query.length >= MIN_SEARCH_CHARS,
  });
}

export function useFollowRequests() {
  return useQuery({
    ...online,
    queryKey: [...SOCIAL_KEY, 'requests'],
    queryFn: () => socialApi.getFollowRequests(),
  });
}
