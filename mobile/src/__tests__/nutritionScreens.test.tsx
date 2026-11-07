import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import { ApiError } from '@/api/client';
import type { NutritionTargets } from '@/api/types';
import { useTextDraft } from '@/nutrition/draft';
import type { createMemoryNutritionRepo } from '@/nutrition/repo';
import { dayKey, shiftDay } from '@/nutrition/rules';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { makeFood, makeLog } from '@/test/nutrition';

import AddFoodScreen from '../../app/(tabs)/nutrition/add';
import CustomFoodScreen from '../../app/(tabs)/nutrition/custom';
import FoodEntryScreen from '../../app/(tabs)/nutrition/food/[id]';
import NutritionScreen from '../../app/(tabs)/nutrition/index';
import ReviewPhotoScreen from '../../app/(tabs)/nutrition/review-photo';
import TargetsScreen from '../../app/(tabs)/nutrition/targets';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('@/api/nutrition', () => ({
  foodByBarcode: jest.fn(),
  getPhotoAnalysis: jest.fn(),
  getTargets: jest.fn(),
  parseFoodText: jest.fn(),
  searchFoods: jest.fn(),
  setTargets: jest.fn(),
  uploadFoodPhoto: jest.fn(),
}));
jest.mock('@/nutrition/photo', () => ({ prepareFoodPhoto: jest.fn(async () => 'file://small') }));
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));
jest.mock('expo-camera', () => ({
  CameraView: jest.fn(() => null),
  useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn()]),
}));

const expoRouter = jest.requireMock<{
  router: Record<'push' | 'replace' | 'back' | 'dismissTo', jest.Mock>;
  useLocalSearchParams: jest.Mock;
}>('expo-router');
const { router } = expoRouter;
type ApiMock =
  'foodByBarcode' | 'getPhotoAnalysis' | 'getTargets' | 'parseFoodText' | 'searchFoods';
const api =
  jest.requireMock<Record<ApiMock | 'setTargets' | 'uploadFoodPhoto', jest.Mock>>(
    '@/api/nutrition',
  );
const picker = jest.requireMock<Record<string, jest.Mock>>('expo-image-picker');
const camera = jest.requireMock<{ CameraView: jest.Mock; useCameraPermissions: jest.Mock }>(
  'expo-camera',
);
const repo = jest.requireMock<{
  sqliteNutritionRepo: ReturnType<typeof createMemoryNutritionRepo>;
}>('@/nutrition/sqliteRepo').sqliteNutritionRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

const TARGETS: NutritionTargets = {
  effective_from: '2026-01-01',
  kcal: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 60,
  reason: 'initial',
};
const OFFLINE = new ApiError(0, 'network_error', 'Network request failed');

const today = () => dayKey(Date.now());

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function params(values: Record<string, string>) {
  expoRouter.useLocalSearchParams.mockReturnValue(values);
}

beforeEach(async () => {
  jest.clearAllMocks();
  expoRouter.useLocalSearchParams.mockReturnValue({});
  camera.useCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
  api.getTargets.mockResolvedValue(TARGETS);
  api.searchFoods.mockResolvedValue({ items: [], partial: false });
  await repo.clear();
  await outbox.clear();
});

describe('The day', () => {
  it('shows the day’s food and totals against the targets', async () => {
    await repo.putLog(makeLog({ log_date: today() }));
    await repo.putLog(makeLog({ id: 'b', log_date: today(), meal: 'snack', kcal: 170 }));

    await show(<NutritionScreen />);

    expect(await screen.findByLabelText('Calories: 500 of 2000 kcal')).toBeOnTheScreen();
    expect(screen.getByText('1500 kcal left of 2000')).toBeOnTheScreen();
    expect(screen.getByLabelText('Protein: 40 of 150 g')).toBeOnTheScreen();
    expect(screen.getByText('330 kcal')).toBeOnTheScreen();
    expect(screen.getByText('170 kcal')).toBeOnTheScreen();
    expect(screen.getByText('Estimates only, not medical advice.')).toBeOnTheScreen();
  });

  it('keeps working offline, with the last known targets', async () => {
    await repo.putTargets(TARGETS);
    api.getTargets.mockRejectedValue(OFFLINE);

    await show(<NutritionScreen />);

    expect(await screen.findByLabelText('Calories: 0 of 2000 kcal')).toBeOnTheScreen();
  });

  it('asks for the profile when there are no targets yet', async () => {
    api.getTargets.mockRejectedValue(new ApiError(409, 'profile_incomplete', 'Finish onboarding'));

    await show(<NutritionScreen />);

    expect(await screen.findByText(/Finish your profile/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Protein: 0 g')).toBeOnTheScreen();
  });

  it('says when a day is over target', async () => {
    await repo.putLog(makeLog({ log_date: today(), kcal: 2100 }));

    await show(<NutritionScreen />);

    expect(await screen.findByText('100 kcal over 2000')).toBeOnTheScreen();
  });

  it('moves between days', async () => {
    await repo.putLog(makeLog({ log_date: shiftDay(today(), -1), name: 'Old dal' }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Previous day'));

    expect(await screen.findByText('Old dal')).toBeOnTheScreen();
    expect(screen.getByText('Yesterday')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Next day'));
    expect(await screen.findByText('Today')).toBeOnTheScreen();
  });

  it('opens add from the one button, and a log to edit it', async () => {
    await repo.putLog(makeLog({ log_date: today() }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Add food'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/add',
      params: { date: today() },
    });

    await fireEvent.press(await screen.findByLabelText('Edit Dal'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/food/[id]',
      params: { id: 'log-1', mode: 'edit' },
    });
  });

  it('removes a food from the list once you confirm, and syncs it', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await repo.putLog(makeLog({ log_date: today() }));
    await repo.putLog(makeLog({ id: 'b', log_date: today(), name: 'Rice', kcal: 170 }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Remove Dal'));
    expect(alert).toHaveBeenCalledWith(
      'Remove food?',
      'Dal will be removed from this day.',
      expect.anything(),
    );
    expect(repo.logs).toHaveLength(2);

    const buttons = alert.mock.calls[0]?.[2];
    await act(async () => buttons?.find((b) => b.text === 'Remove')?.onPress?.());

    await waitFor(() => expect(screen.queryByLabelText('Edit Dal')).toBeNull());
    expect(screen.getByLabelText('Edit Rice')).toBeOnTheScreen();
    expect(repo.logs.map((log) => log.id)).toEqual(['b']);
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'food_log', entityId: 'log-1', op: 'delete' }),
    ]);
    alert.mockRestore();
  });

  it('keeps the food if you cancel', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await repo.putLog(makeLog({ log_date: today() }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Remove Dal'));
    await act(async () => alert.mock.calls[0]?.[2]?.[0]?.onPress?.());

    expect(repo.logs).toHaveLength(1);
    expect(outbox.items).toEqual([]);
    alert.mockRestore();
  });

  it('links to the weekly report', async () => {
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Weekly report'));

    expect(router.push).toHaveBeenCalledWith('/coach/weekly');
  });

  it('copies the day’s food to tomorrow', async () => {
    await repo.putLog(makeLog({ log_date: today() }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Food logged options'));
    await fireEvent.press(screen.getByText('Copy to tomorrow'));

    await waitFor(async () =>
      expect(await repo.logsOn(shiftDay(today(), 1))).toEqual([
        expect.objectContaining({ name: 'Dal', meal: 'lunch', version: 0 }),
      ]),
    );
    expect(outbox.items).toHaveLength(1);
  });

  it('copies the day’s food to a typed date, refusing one that isn’t real', async () => {
    await repo.putLog(makeLog({ log_date: today() }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Food logged options'));
    await fireEvent.press(screen.getByText('Copy to another day'));
    await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), '2026-02-30');
    await fireEvent.press(screen.getByLabelText('Copy'));
    expect(await screen.findByText(/Use a date like/)).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), '2026-03-01');
    await fireEvent.press(screen.getByLabelText('Copy'));
    await waitFor(async () => expect(await repo.logsOn('2026-03-01')).toHaveLength(1));
  });

  it('saves the day’s food as a template', async () => {
    await repo.putLog(makeLog({ log_date: today() }));
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Food logged options'));
    await fireEvent.press(screen.getByText('Save as a meal'));
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Usual lunch');
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(async () =>
      expect(await repo.savedMeals()).toEqual([expect.objectContaining({ name: 'Usual lunch' })]),
    );
  });
});

describe('Adding food', () => {
  it('searches the device and the server, and opens a food', async () => {
    await repo.putFood(makeFood({ id: 'mine', name: 'Mom’s dal', is_custom: true }));
    const found = makeFood({ id: 'usda', name: 'Dal, cooked' });
    api.searchFoods.mockResolvedValue({ items: [found], partial: false });
    params({ date: '2026-11-05', meal: 'lunch' });
    await show(<AddFoodScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Search foods'), 'dal');

    expect(await screen.findByText('Mom’s dal', {}, { timeout: 2000 })).toBeOnTheScreen();
    await fireEvent.press(await screen.findByLabelText('Dal, cooked'));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/nutrition/food/[id]',
        params: { id: 'usda', date: '2026-11-05', meal: 'lunch', source: 'search' },
      }),
    );
    expect(await repo.food('usda')).toEqual(found);
  });

  it('finds foods on the device when offline, and says the list may be incomplete', async () => {
    await repo.putFood(makeFood({ name: 'Dal' }));
    api.searchFoods.mockRejectedValue(OFFLINE);
    await show(<AddFoodScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Search foods'), 'dal');

    expect(await screen.findByText(/may be incomplete/, {}, { timeout: 2000 })).toBeOnTheScreen();
    expect(screen.getByLabelText('Dal')).toBeOnTheScreen();
  });

  it('lists custom foods before a search, and opens the form with what was typed', async () => {
    await repo.putFood(makeFood({ name: 'Mine', is_custom: true }));
    params({ date: '2026-11-05', meal: 'lunch' });
    await show(<AddFoodScreen />);

    expect(await screen.findByText('My foods')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'x');
    await fireEvent.press(screen.getByLabelText('Create a food'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/custom',
      params: { date: '2026-11-05', meal: 'lunch', name: 'x' },
    });
  });

  it('scans a barcode into a food', async () => {
    const food = makeFood({ id: 'scanned', name: 'Oats', barcode: '8901058851298' });
    api.foodByBarcode.mockResolvedValue(food);
    params({ date: '2026-11-05', meal: 'breakfast' });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Barcode'));
    const scan = camera.CameraView.mock.calls.at(-1)?.[0] as {
      onBarcodeScanned: (event: { data: string }) => void;
    };
    await act(async () => {
      scan.onBarcodeScanned({ data: '8901058851298' });
      scan.onBarcodeScanned({ data: '8901058851298' });
    });

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/nutrition/food/[id]',
        params: { id: 'scanned', date: '2026-11-05', meal: 'breakfast', source: 'barcode' },
      }),
    );
    expect(api.foodByBarcode).toHaveBeenCalledTimes(1);
  });

  it('offers to create a food for an unknown barcode', async () => {
    api.foodByBarcode.mockRejectedValue(new ApiError(404, 'not_found', 'Not found'));
    params({ date: '2026-11-05', meal: 'lunch' });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Barcode'));
    await fireEvent.changeText(screen.getByLabelText('Or type the barcode'), '12345678');
    await fireEvent.press(screen.getByLabelText('Look up'));
    await fireEvent.press(await screen.findByLabelText('Create this food'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/custom',
      params: { date: '2026-11-05', meal: 'lunch', barcode: '12345678' },
    });
  });

  it('explains a barcode lookup while offline, and asks for the camera first', async () => {
    camera.useCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);
    api.foodByBarcode.mockRejectedValue(OFFLINE);
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Barcode'));
    expect(screen.getByLabelText('Allow camera')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Or type the barcode'), '12345678');
    await fireEvent.press(screen.getByLabelText('Look up'));

    expect(await screen.findByText(/needs a connection/)).toBeOnTheScreen();
  });

  it('repeats a recent food, and ranks frequent ones', async () => {
    await repo.putLog(makeLog({ id: 'a', food_id: 'rice', name: 'Rice' }));
    await repo.putLog(makeLog({ id: 'b', created_at: '2026-11-04T07:00:00.000Z' }));
    await repo.putLog(makeLog({ id: 'c', created_at: '2026-11-04T08:00:00.000Z' }));
    params({ date: '2026-11-05', meal: 'lunch' });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Recent'));
    await fireEvent.press(await screen.findByLabelText('Rice'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/food/[id]',
      params: { id: 'a', mode: 'repeat', date: '2026-11-05', meal: 'lunch' },
    });

    await fireEvent.press(screen.getByLabelText('Order: Frequent'));
    expect(await screen.findByText('200 g · 2 times')).toBeOnTheScreen();
    expect(screen.queryByText('Rice')).toBeNull();
  });

  it('logs a saved meal in one tap, and deletes one', async () => {
    const item = {
      food_id: 'food-1',
      name: 'Dal',
      quantity: 100,
      unit: 'g',
      grams: 100,
      per_100g: { kcal: 165, protein: 10, carbs: 20, fat: 5, fiber: null },
    };
    const meal = { id: 'm', name: 'Usual', items: [item], version: 1, updated_at: '' };
    await repo.putSavedMeal(meal);
    await repo.putSavedMeal({ ...meal, id: 'n', name: 'Other' });
    params({ date: '2026-11-05', meal: 'dinner' });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Saved'));
    await fireEvent.press(await screen.findByLabelText('Delete Other'));
    await waitFor(() => expect(screen.queryByText('Other')).toBeNull());
    await fireEvent.press(screen.getByLabelText('Log Usual'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/nutrition'));
    expect(await repo.logsOn('2026-11-05')).toEqual([
      expect.objectContaining({ name: 'Dal', meal: 'dinner', kcal: 165 }),
    ]);
  });

  it('sends a photo and opens its review', async () => {
    picker.requestCameraPermissionsAsync?.mockResolvedValue({ granted: true });
    picker.launchCameraAsync?.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://big', width: 4000, height: 3000 }],
    });
    api.uploadFoodPhoto.mockResolvedValue({ analysis_id: 'a1' });
    params({ date: '2026-11-05', meal: 'lunch' });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Photo'));
    await fireEvent.press(screen.getByLabelText('Take a photo'));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/nutrition/review-photo',
        params: { analysis: 'a1', date: '2026-11-05', meal: 'lunch' },
      }),
    );
    expect(api.uploadFoodPhoto).toHaveBeenCalledWith('file://small');
  });

  it.each([
    ['rate_limited', 429, /today’s photo analyses/],
    ['ai_unavailable', 503, /isn’t available/],
    ['network_error', 0, /needs a connection/],
    ['other', 500, /couldn’t be sent/],
  ])('explains %s when a photo can’t be sent', async (code, status, message) => {
    picker.requestMediaLibraryPermissionsAsync?.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync?.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://big', width: 100, height: 100 }],
    });
    api.uploadFoodPhoto.mockRejectedValue(new ApiError(status, code, 'No'));
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Photo'));
    await fireEvent.press(screen.getByLabelText('Choose a photo'));

    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it('asks for camera access, and does nothing if the picker is cancelled', async () => {
    picker.requestCameraPermissionsAsync?.mockResolvedValue({ granted: false });
    picker.requestMediaLibraryPermissionsAsync?.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync?.mockResolvedValue({ canceled: true, assets: [] });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Photo'));
    await fireEvent.press(screen.getByLabelText('Take a photo'));
    expect(await screen.findByText(/Allow camera access/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Choose a photo'));
    await waitFor(() => expect(picker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(api.uploadFoodPhoto).not.toHaveBeenCalled();
  });

  it('reads typed food into a draft and opens its review', async () => {
    const draft = { items: [{ name: 'Dal' }], notes: '' };
    api.parseFoodText.mockResolvedValue(draft);
    params({ date: '2026-11-05', meal: 'lunch' });
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Text'));
    await fireEvent.changeText(screen.getByLabelText('What did you eat?'), ' 2 rotis ');
    await fireEvent.press(screen.getByLabelText('Read it'));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/nutrition/review-photo',
        params: { date: '2026-11-05', meal: 'lunch' },
      }),
    );
    expect(api.parseFoodText).toHaveBeenCalledWith('2 rotis');
    expect(useTextDraft.getState().draft).toEqual(draft);
  });

  it.each([
    ['no food', { items: [], notes: '' }, /No food was found/],
    ['a limit', new ApiError(429, 'rate_limited', 'No'), /today’s text entries/],
    ['no connection', OFFLINE, /needs a connection/],
    ['trouble', new ApiError(500, 'http_error', 'No'), /couldn’t be read/],
  ])('explains %s when typing a meal', async (_, outcome, message) => {
    if (outcome instanceof Error) api.parseFoodText.mockRejectedValue(outcome);
    else api.parseFoodText.mockResolvedValue(outcome);
    await show(<AddFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Text'));
    await fireEvent.changeText(screen.getByLabelText('What did you eat?'), 'x');
    await fireEvent.press(screen.getByLabelText('Read it'));

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('Reviewing a photo', () => {
  const ITEM = {
    name: 'Dal',
    food_id: null,
    grams: 200,
    per_100g: { kcal: 100, protein: 8, carbs: 10, fat: 3, fiber: null },
    kcal: 200,
    protein_g: 16,
    carbs_g: 20,
    fat_g: 6,
    fiber_g: null,
    confidence: 0.4,
  };
  const done = (items: unknown[], notes = 'Oil may be higher.') => ({
    id: 'a1',
    status: 'done',
    draft: { items, notes },
    error: null,
    created_at: '',
  });

  beforeEach(() => params({ analysis: 'a1', date: '2026-11-05', meal: 'dinner' }));

  it('waits for the worker, then shows the draft', async () => {
    api.getPhotoAnalysis.mockResolvedValue({ ...done([ITEM]), status: 'pending', draft: null });

    await show(<ReviewPhotoScreen />);

    expect(await screen.findByText('Reading your photo…')).toBeOnTheScreen();
  });

  it('lets each item be edited before anything is logged', async () => {
    api.getPhotoAnalysis.mockResolvedValue(done([ITEM]));
    await show(<ReviewPhotoScreen />);

    expect(await screen.findByText('Oil may be higher.')).toBeOnTheScreen();
    expect(screen.getByText(/Check this one/)).toBeOnTheScreen();
    expect(repo.logs).toEqual([]);

    await fireEvent.changeText(screen.getByLabelText('Dal grams'), '100');
    expect(screen.getByLabelText('Dal calories')).toHaveProp('value', '100');
    await fireEvent.changeText(screen.getByLabelText('Dal protein'), '20');
    // 4 × 20 + 4 × 10 + 9 × 3.
    expect(screen.getByLabelText('Dal calories')).toHaveProp('value', '147');
    await fireEvent.press(screen.getByLabelText('Add 147 kcal'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/nutrition'));
    expect(await repo.logsOn('2026-11-05')).toEqual([
      expect.objectContaining({
        name: 'Dal',
        meal: 'dinner',
        grams: 100,
        protein_g: 20,
        source: 'photo',
        photo_analysis_id: 'a1',
      }),
    ]);
  });

  it('removes an item, and needs a name on the others', async () => {
    api.getPhotoAnalysis.mockResolvedValue(
      done([ITEM, { ...ITEM, name: 'Rice', food_id: 'food-1', confidence: 0.9 }], ''),
    );
    await show(<ReviewPhotoScreen />);

    expect(await screen.findByText('Numbers from the food database')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Remove Dal'));
    expect(screen.queryByLabelText('Dal grams')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Item'), ' ');
    await fireEvent.press(screen.getByLabelText('Add 200 kcal'));

    expect(await screen.findByText('Every item needs a name')).toBeOnTheScreen();
    expect(repo.logs).toEqual([]);
  });

  it.each([
    ['failed', { ...done([]), status: 'failed', draft: null }, /couldn’t be analysed/],
    ['empty', done([]), /No food was found/],
  ])('offers manual entry when the result is %s', async (_, analysis, message) => {
    api.getPhotoAnalysis.mockResolvedValue(analysis);
    await show(<ReviewPhotoScreen />);

    expect(await screen.findByText(message)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Add it by hand'));
    expect(router.back).toHaveBeenCalled();
  });

  it('says when the server can’t be reached', async () => {
    api.getPhotoAnalysis.mockRejectedValue(OFFLINE);
    await show(<ReviewPhotoScreen />);

    expect(await screen.findByText(/can’t be reached/)).toBeOnTheScreen();
  });

  it('reviews a draft read from text, logging it as text', async () => {
    useTextDraft.setState({ draft: { items: [ITEM], notes: '' } });
    params({ date: '2026-11-05', meal: 'dinner' });
    await show(<ReviewPhotoScreen />);

    await fireEvent.press(await screen.findByLabelText('Add 200 kcal'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
    expect(await repo.logsOn('2026-11-05')).toEqual([
      expect.objectContaining({ source: 'text', photo_analysis_id: null }),
    ]);
    expect(api.getPhotoAnalysis).not.toHaveBeenCalled();
  });

  it('has nothing to show if the text draft is gone', async () => {
    useTextDraft.setState({ draft: null });
    params({ date: '2026-11-05', meal: 'dinner' });
    await show(<ReviewPhotoScreen />);

    expect(await screen.findByText('There’s nothing to review.')).toBeOnTheScreen();
  });
});

describe('A food entry', () => {
  it('logs a food, scaled to its serving, while offline', async () => {
    await repo.putFood(makeFood({ servings: [{ label: '1 bowl', grams: 200 }] }));
    params({ id: 'food-1', date: '2026-11-05', meal: 'lunch', source: 'barcode' });
    await show(<FoodEntryScreen />);

    expect(await screen.findByLabelText('Calories')).toHaveProp('value', '330');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '1.5');
    expect(screen.getByLabelText('Calories')).toHaveProp('value', '495');
    await fireEvent.press(screen.getByLabelText('Add food'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/nutrition'));
    expect(await repo.logsOn('2026-11-05')).toEqual([
      expect.objectContaining({ quantity: 1.5, unit: '1 bowl', grams: 300, source: 'barcode' }),
    ]);
    expect(outbox.items).toEqual([expect.objectContaining({ entity: 'food_log', op: 'upsert' })]);
  });

  it('recomputes calories when protein is edited', async () => {
    await repo.putFood(makeFood());
    params({ id: 'food-1', date: '2026-11-05', meal: 'lunch' });
    await show(<FoodEntryScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Protein'), '20');

    // 4 × 20 + 4 × 20 + 9 × 5.
    expect(screen.getByLabelText('Calories')).toHaveProp('value', '205');
    await fireEvent.press(screen.getByLabelText('Add food'));

    await waitFor(() => expect(outbox.items).toHaveLength(1));
    expect(outbox.items[0]?.data).toMatchObject({
      macros: { protein_g: 20, carbs_g: 20, fat_g: 5, fiber_g: null },
      kcal: null,
    });
  });

  it('flags calories typed by hand, and can go back to the food’s values', async () => {
    await repo.putFood(makeFood());
    params({ id: 'food-1', date: '2026-11-05', meal: 'lunch' });
    await show(<FoodEntryScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Calories'), '400');
    expect(screen.getByLabelText('Calories (manual)')).toHaveProp('value', '400');

    await fireEvent.press(screen.getByLabelText('Use the food’s values'));
    expect(screen.getByLabelText('Calories')).toHaveProp('value', '165');
  });

  it('stops at an impossible amount', async () => {
    await repo.putFood(makeFood());
    params({ id: 'food-1', date: '2026-11-05', meal: 'lunch' });
    await show(<FoodEntryScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Amount'), '');
    await fireEvent.press(screen.getByLabelText('Add food'));

    expect(await screen.findByText('Enter an amount')).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });

  it('edits a log from its snapshot, even after the food changed', async () => {
    await repo.putFood(makeFood({ kcal_100g: 999 }));
    await repo.putLog(makeLog({ version: 2 }));
    params({ id: 'log-1', mode: 'edit' });
    await show(<FoodEntryScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Amount'), '100');
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
    expect(await repo.log('log-1')).toMatchObject({ kcal: 165, meal: 'lunch', quantity: 100 });
    expect(outbox.items[0]).toMatchObject({ baseVersion: 2 });
  });

  it('removes a log', async () => {
    await repo.putLog(makeLog());
    params({ id: 'log-1', mode: 'edit' });
    await show(<FoodEntryScreen />);

    await fireEvent.press(await screen.findByLabelText('Remove from log'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
    expect(repo.logs).toEqual([]);
  });

  it('repeats a past log without its overrides, even with the food gone', async () => {
    await repo.putLog(makeLog({ kcal: 999, kcal_overridden: true, unit: 'bowl', quantity: 1 }));
    params({ id: 'log-1', mode: 'repeat', date: '2026-11-05', meal: 'dinner' });
    await show(<FoodEntryScreen />);

    expect(await screen.findByLabelText('Calories')).toHaveProp('value', '330');
    await fireEvent.press(screen.getByLabelText('Add food'));

    await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
    expect(await repo.logsOn('2026-11-05')).toEqual([
      expect.objectContaining({ source: 'recent', meal: 'dinner', food_id: 'food-1', grams: 200 }),
    ]);
  });

  it('links a custom food to its form', async () => {
    await repo.putFood(makeFood({ is_custom: true }));
    params({ id: 'food-1' });
    await show(<FoodEntryScreen />);

    await fireEvent.press(await screen.findByLabelText('Edit this food'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/custom',
      params: { id: 'food-1' },
    });
  });

  it('says so when the entry has gone', async () => {
    params({ id: 'missing', mode: 'edit' });
    await show(<FoodEntryScreen />);

    expect(await screen.findByText('This entry is no longer here.')).toBeOnTheScreen();
  });
});

describe('Daily targets', () => {
  it('opens from the day', async () => {
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Edit daily targets'));

    expect(router.push).toHaveBeenCalledWith('/nutrition/targets');
  });

  it('starts from the current targets, saves new ones and keeps them for offline', async () => {
    const saved = { ...TARGETS, effective_from: today(), kcal: 2400, reason: 'manual' };
    api.setTargets.mockResolvedValue(saved);
    await show(<TargetsScreen />);

    expect(await screen.findByLabelText('Calories')).toHaveProp('value', '2000');
    expect(screen.getByLabelText('Protein')).toHaveProp('value', '150');
    expect(screen.getByText('These macros add up to 1940 kcal.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Calories'), '2400');
    await fireEvent.changeText(screen.getByLabelText('Protein'), '180');
    await fireEvent.press(screen.getByLabelText('Save targets'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(api.setTargets).toHaveBeenCalledWith({
      kcal: 2400,
      protein_g: 180,
      carbs_g: 200,
      fat_g: 60,
    });
    expect(await repo.targetsOn(today())).toMatchObject({ kcal: 2400, reason: 'manual' });
  });

  it('shows the server’s safe minimum under the calories', async () => {
    api.setTargets.mockRejectedValue(
      new ApiError(422, 'target_below_safe_minimum', 'Daily calories can’t go below 1800 kcal.', {
        minimum_kcal: 1800,
      }),
    );
    await show(<TargetsScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Calories'), '900');
    await fireEvent.press(screen.getByLabelText('Save targets'));

    expect(await screen.findByText(/can’t go below 1800 kcal/)).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says so when it can’t reach the server, and refuses bad numbers first', async () => {
    api.setTargets.mockRejectedValue(OFFLINE);
    await show(<TargetsScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Fat'), '60.5');
    await fireEvent.press(screen.getByLabelText('Save targets'));
    expect(await screen.findByText(/whole number from 0 to 1000/)).toBeOnTheScreen();
    expect(api.setTargets).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Fat'), '60');
    await fireEvent.press(screen.getByLabelText('Save targets'));
    expect(await screen.findByText(/Can't reach RepForge/)).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('A custom food', () => {
  async function fill() {
    await fireEvent.changeText(screen.getByLabelText('Calories per 100 g'), '120');
    await fireEvent.changeText(screen.getByLabelText('Protein per 100 g'), '7');
    await fireEvent.changeText(screen.getByLabelText('Carbs per 100 g'), '15');
    await fireEvent.changeText(screen.getByLabelText('Fat per 100 g'), '3');
  }

  it('creates a food with a serving, then opens it to log', async () => {
    params({ name: 'Mom’s dal', barcode: '12345678', date: '2026-11-05', meal: 'lunch' });
    await show(<CustomFoodScreen />);

    expect(await screen.findByLabelText('Name')).toHaveProp('value', 'Mom’s dal');
    expect(screen.getByLabelText('Barcode (optional)')).toHaveProp('value', '12345678');
    await fill();
    await fireEvent.press(screen.getByLabelText('Add a serving'));
    await fireEvent.changeText(screen.getByLabelText('Serving 1'), '1 katori');
    await fireEvent.changeText(screen.getByLabelText('Grams in serving 1'), '150');
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const [food] = await repo.customFoods();
    expect(food).toMatchObject({
      name: 'Mom’s dal',
      barcode: '12345678',
      kcal_100g: 120,
      servings: [{ label: '1 katori', grams: 150 }],
    });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/nutrition/food/[id]',
      params: { id: food?.id, date: '2026-11-05', meal: 'lunch', source: 'manual' },
    });
  });

  it('shows what’s wrong instead of saving', async () => {
    await show(<CustomFoodScreen />);

    await fireEvent.press(await screen.findByLabelText('Save'));

    expect(await screen.findByText('Give it a name')).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });

  it('edits a food, leaving past logs alone', async () => {
    const food = makeFood({
      is_custom: true,
      source: 'custom',
      fiber_100g: 2,
      servings: [{ label: '1 bowl', grams: 200 }],
    });
    await repo.putFood(food);
    const log = makeLog();
    await repo.putLog(log);
    params({ id: 'food-1' });
    await show(<CustomFoodScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Calories per 100 g'), '500');
    await fireEvent.press(screen.getByLabelText('Remove serving 1'));
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(await repo.food('food-1')).toMatchObject({ kcal_100g: 500, servings: [] });
    expect(await repo.log('log-1')).toEqual(log);
    expect(outbox.items[0]).toMatchObject({ entity: 'food', baseVersion: 1 });
  });
});
