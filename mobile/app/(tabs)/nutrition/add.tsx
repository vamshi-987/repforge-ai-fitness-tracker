import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { parseFoodText, uploadFoodPhoto } from '@/api/nutrition';
import type { Food, LogSource, Meal, SavedMeal } from '@/api/types';
import { BarcodeScanner } from '@/components/nutrition/BarcodeScanner';
import { FoodRow } from '@/components/nutrition/FoodRow';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import {
  deleteSavedMeal,
  findBarcode,
  logSavedMeal,
  rememberFood,
  type BarcodeResult,
} from '@/nutrition/actions';
import { useTextDraft } from '@/nutrition/draft';
import { prepareFoodPhoto } from '@/nutrition/photo';
import { dayKey, formatAmount, MEAL_LABELS, mealAt, type RecentFood } from '@/nutrition/rules';
import {
  NUTRITION_QUERY_KEY,
  SEARCH_MIN_CHARS,
  useCustomFoods,
  useFoodSearch,
  useRecentFoods,
  useSavedMeals,
} from '@/nutrition/store';
import { useTheme } from '@/theme/useTheme';

const SEARCH_DEBOUNCE_MS = 300;
const TABS = ['Search', 'Barcode', 'Recent', 'Saved', 'Photo', 'Text'] as const;
type Tab = (typeof TABS)[number];

interface Target {
  date: string;
  meal: Meal;
}

function foodDetail(food: Food): string {
  const per100 = `${Math.round(food.kcal_100g)} kcal per 100 g`;
  return food.brand ? `${food.brand} · ${per100}` : per100;
}

function openFood(food: Food, target: Target, source: LogSource) {
  router.push({
    pathname: '/nutrition/food/[id]',
    params: { id: food.id, date: target.date, meal: target.meal, source },
  });
}

function SearchTab({ target }: { target: Target }) {
  const { colors, spacing, typography } = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const results = useFoodSearch(query);
  const custom = useCustomFoods();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  async function pick(food: Food) {
    await rememberFood(food);
    openFood(food, target, 'search');
  }

  const searching = query.length >= SEARCH_MIN_CHARS;
  const foods = searching ? results.items : (custom.data ?? []);

  return (
    <View style={{ gap: spacing.sm }}>
      <TextField
        label="Search foods"
        value={text}
        onChangeText={setText}
        autoCorrect={false}
        returnKeyType="search"
      />
      {!searching && foods.length > 0 ? (
        <Text style={[typography.caption, { color: colors.textMuted }]}>My foods</Text>
      ) : null}
      {results.searching ? <ActivityIndicator color={colors.primary} /> : null}
      {foods.map((food) => (
        <FoodRow
          key={food.id}
          title={food.name}
          detail={foodDetail(food)}
          onPress={() => void pick(food)}
        />
      ))}
      {searching && !results.searching && foods.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>No foods found.</Text>
      ) : null}
      {results.partial && !results.searching ? (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          Some sources couldn’t be reached, so this list may be incomplete.
        </Text>
      ) : null}
      <Button
        label="Create a food"
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/nutrition/custom', params: { ...target, name: text.trim() } })
        }
      />
    </View>
  );
}

const BARCODE_MESSAGES: Record<Exclude<BarcodeResult['kind'], 'found'>, string> = {
  unknown: 'This barcode isn’t in the food database yet. You can add it as your own food.',
  offline: 'Looking up a new barcode needs a connection. Foods you’ve used before work offline.',
  unavailable: 'The food database can’t be reached right now. Try again shortly.',
};

function BarcodeTab({ target }: { target: Target }) {
  const { colors, spacing, typography } = useTheme();
  const [miss, setMiss] = useState<{ code: string; result: BarcodeResult['kind'] } | null>(null);

  async function look(code: string) {
    const result = await findBarcode(code);
    if (result.kind === 'found') {
      setMiss(null);
      openFood(result.food, target, 'barcode');
    } else {
      setMiss({ code, result: result.kind });
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <BarcodeScanner onCode={look} />
      {miss && miss.result !== 'found' ? (
        <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.text }]}>
          {BARCODE_MESSAGES[miss.result]}
        </Text>
      ) : null}
      {miss?.result === 'unknown' ? (
        <Button
          label="Create this food"
          onPress={() =>
            router.push({
              pathname: '/nutrition/custom',
              params: { ...target, barcode: miss.code },
            })
          }
        />
      ) : null}
    </View>
  );
}

function RecentTab({ target }: { target: Target }) {
  const { colors, spacing, typography } = useTheme();
  const foods = useRecentFoods();
  const [order, setOrder] = useState<'recent' | 'frequent'>('recent');
  const list: RecentFood[] = foods.data?.[order] ?? [];

  return (
    <View style={{ gap: spacing.sm }}>
      <SegmentedControl
        label="Order"
        value={order}
        onChange={setOrder}
        segments={[
          { value: 'recent', label: 'Recent' },
          { value: 'frequent', label: 'Frequent' },
        ]}
      />
      {list.map(({ log, times }) => (
        <FoodRow
          key={log.food_id}
          title={log.name}
          detail={`${formatAmount(log.quantity)} ${log.unit}${times > 1 ? ` · ${times} times` : ''}`}
          value={`${Math.round(log.kcal)} kcal`}
          onPress={() =>
            router.push({
              pathname: '/nutrition/food/[id]',
              params: { id: log.id, mode: 'repeat', date: target.date, meal: target.meal },
            })
          }
        />
      ))}
      {foods.isSuccess && list.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          {order === 'recent'
            ? 'Foods you log will show up here.'
            : 'Foods you log more than once will show up here.'}
        </Text>
      ) : null}
    </View>
  );
}

function SavedTab({ target }: { target: Target }) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const meals = useSavedMeals();
  const refresh = () => queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });

  async function log(meal: SavedMeal) {
    await logSavedMeal(meal, target.date, target.meal);
    await refresh();
    router.dismissTo('/nutrition');
  }

  async function remove(meal: SavedMeal) {
    await deleteSavedMeal(meal.id);
    await refresh();
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {meals.data?.map((meal) => (
        <View key={meal.id} style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.flex}>
            <FoodRow
              title={meal.name}
              detail={meal.items.map((i) => i.name).join(', ')}
              accessibilityLabel={`Log ${meal.name}`}
              onPress={() => void log(meal)}
            />
          </View>
          <Text
            accessibilityRole="button"
            accessibilityLabel={`Delete ${meal.name}`}
            onPress={() => void remove(meal)}
            style={[typography.caption, { color: colors.danger }]}
          >
            Delete
          </Text>
        </View>
      ))}
      {meals.isSuccess && meals.data.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Save a meal from its ⋯ menu to log it again in one tap.
        </Text>
      ) : null}
    </View>
  );
}

const PHOTO_ERRORS: Record<string, string> = {
  rate_limited: 'You’ve used today’s photo analyses. Search or add the food by hand.',
  ai_unavailable: 'Food recognition isn’t available right now. Add the food by hand.',
  network_error: 'Reading a photo needs a connection. Search your foods instead.',
};

function PhotoTab({ target }: { target: Target }) {
  const { colors, spacing, typography } = useTheme();
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
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'] };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setBusy(true);
    try {
      const { analysis_id } = await uploadFoodPhoto(await prepareFoodPhoto(asset));
      router.push({
        pathname: '/nutrition/review-photo',
        params: { analysis: analysis_id, date: target.date, meal: target.meal },
      });
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : '';
      setError(PHOTO_ERRORS[code] ?? 'That photo couldn’t be sent. Add the food by hand.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.body, { color: colors.textMuted }]}>
        Take a photo of your plate. You’ll check every item before it’s logged.
      </Text>
      <Button label="Take a photo" loading={busy} onPress={() => void pick('camera')} />
      <Button
        label="Choose a photo"
        variant="secondary"
        disabled={busy}
        onPress={() => void pick('library')}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const TEXT_ERRORS: Record<string, string> = {
  rate_limited: 'You’ve used today’s text entries. Search or add the food by hand.',
  ai_unavailable: 'That couldn’t be read right now. Add the food by hand.',
  network_error: 'Reading text needs a connection. Search your foods instead.',
};

function TextTab({ target }: { target: Target }) {
  const { colors, spacing, typography } = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function read() {
    setBusy(true);
    setMessage(null);
    try {
      const draft = await parseFoodText(text.trim());
      if (draft.items.length === 0) {
        setMessage('No food was found in that. Try naming what you ate.');
        return;
      }
      useTextDraft.setState({ draft });
      router.push({
        pathname: '/nutrition/review-photo',
        params: { date: target.date, meal: target.meal },
      });
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : '';
      setMessage(TEXT_ERRORS[code] ?? 'That couldn’t be read right now. Add the food by hand.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <TextField
        label="What did you eat?"
        placeholder="2 rotis and a bowl of dal"
        value={text}
        onChangeText={setText}
        maxLength={500}
        multiline
      />
      <Button
        label="Read it"
        loading={busy}
        disabled={text.trim().length === 0}
        onPress={() => void read()}
      />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.danger }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

/** Find something to log. Everything but the online searches works offline. */
export default function AddFoodScreen() {
  const { colors, spacing, typography } = useTheme();
  const params = useLocalSearchParams<{ date?: string; meal?: Meal }>();
  // Read once: the day being logged doesn't change while this screen is open.
  const [target] = useState<Target>(() => ({
    date: params.date ?? dayKey(Date.now()),
    meal: params.meal ?? mealAt(Date.now()),
  }));
  const [tab, setTab] = useState<Tab>('Search');

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Adding to {MEAL_LABELS[target.meal]}, {target.date}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.row, { gap: spacing.xs }]}>
          {TABS.map((name) => (
            <Chip key={name} label={name} selected={tab === name} onPress={() => setTab(name)} />
          ))}
        </View>
      </ScrollView>
      {tab === 'Search' ? <SearchTab target={target} /> : null}
      {tab === 'Barcode' ? <BarcodeTab target={target} /> : null}
      {tab === 'Recent' ? <RecentTab target={target} /> : null}
      {tab === 'Saved' ? <SavedTab target={target} /> : null}
      {tab === 'Photo' ? <PhotoTab target={target} /> : null}
      {tab === 'Text' ? <TextTab target={target} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
