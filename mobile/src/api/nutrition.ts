import { session } from '@/auth/session';

import type { Food, FoodDraft, FoodSearch, NutritionTargets, PhotoAnalysis } from './types';

export function searchFoods(query: string): Promise<FoodSearch> {
  return session.request<FoodSearch>(`/foods/search?${new URLSearchParams({ q: query })}`);
}

export function foodByBarcode(code: string): Promise<Food> {
  return session.request<Food>(`/foods/barcode/${code}`);
}

export function getTargets(day: string): Promise<NutritionTargets> {
  return session.request<NutritionTargets>(`/nutrition/targets?date=${day}`);
}

export function uploadFoodPhoto(uri: string): Promise<{ analysis_id: string }> {
  const form = new FormData();
  // React Native's FormData takes a file as { uri, name, type }; the DOM types only know Blob.
  form.append('file', { uri, name: 'meal.jpg', type: 'image/jpeg' } as unknown as Blob);
  return session.request('/nutrition/photo', { method: 'POST', form });
}

export function getPhotoAnalysis(id: string): Promise<PhotoAnalysis> {
  return session.request<PhotoAnalysis>(`/nutrition/photo/${id}`);
}

export function parseFoodText(text: string): Promise<FoodDraft> {
  return session.request<FoodDraft>('/nutrition/parse-text', { method: 'POST', body: { text } });
}
