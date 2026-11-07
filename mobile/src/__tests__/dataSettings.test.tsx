import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { DataSettings } from '@/components/DataSettings';
import { describeImport } from '@/settings/importReport';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';

jest.mock('@/api/portability', () => ({
  closeAccount: jest.fn(),
  exportEverything: jest.fn(),
  exportWorkoutsCsv: jest.fn(),
  importWorkoutsCsv: jest.fn(),
}));
jest.mock('@/settings/dataFile', () => ({ shareTextFile: jest.fn(async () => undefined) }));
jest.mock('@/sync/queue', () => ({ wakeSync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const api =
  jest.requireMock<
    Record<
      'closeAccount' | 'exportEverything' | 'exportWorkoutsCsv' | 'importWorkoutsCsv',
      jest.Mock
    >
  >('@/api/portability');
const { shareTextFile } = jest.requireMock<{ shareTextFile: jest.Mock }>('@/settings/dataFile');
const { wakeSync } = jest.requireMock<{ wakeSync: jest.Mock }>('@/sync/queue');
const picker = jest.requireMock<{ getDocumentAsync: jest.Mock }>('expo-document-picker');

const OFFLINE = new ApiError(0, 'network_error', 'Offline');
const signOut = jest.fn(async () => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }), signOut });
});

describe('Your data', () => {
  it('shares everything as a JSON file', async () => {
    api.exportEverything.mockResolvedValue({ workouts: [] });
    await render(<DataSettings />);

    await fireEvent.press(screen.getByLabelText('Export all my data'));

    await waitFor(() =>
      expect(shareTextFile).toHaveBeenCalledWith(
        'repforge-export.json',
        expect.stringContaining('"workouts"'),
        'application/json',
      ),
    );
  });

  it('shares workouts as CSV', async () => {
    api.exportWorkoutsCsv.mockResolvedValue('title\nPush\n');
    await render(<DataSettings />);

    await fireEvent.press(screen.getByLabelText('Export workouts (CSV)'));

    await waitFor(() =>
      expect(shareTextFile).toHaveBeenCalledWith(
        'repforge-workouts.csv',
        'title\nPush\n',
        'text/csv',
      ),
    );
  });

  it('says when exporting needs a connection', async () => {
    api.exportEverything.mockRejectedValue(OFFLINE);
    await render(<DataSettings />);

    await fireEvent.press(screen.getByLabelText('Export all my data'));

    expect(await screen.findByText(/needs a connection/)).toBeOnTheScreen();
  });

  it('imports a file, reports on it, and syncs', async () => {
    picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://w.csv', name: 'w.csv' }],
    });
    api.importWorkoutsCsv.mockResolvedValue({
      imported: 3,
      duplicates: 1,
      unknown_exercises: [],
      invalid: [],
    });
    await render(<DataSettings />);

    await fireEvent.press(screen.getByLabelText('Import workouts (CSV)'));

    expect(await screen.findByText('3 workouts imported. 1 already here.')).toBeOnTheScreen();
    expect(api.importWorkoutsCsv).toHaveBeenCalledWith('file://w.csv', 'w.csv');
    expect(wakeSync).toHaveBeenCalled();
  });

  it('does nothing if the picker is cancelled', async () => {
    picker.getDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
    await render(<DataSettings />);

    await fireEvent.press(screen.getByLabelText('Import workouts (CSV)'));

    await waitFor(() => expect(picker.getDocumentAsync).toHaveBeenCalled());
    expect(api.importWorkoutsCsv).not.toHaveBeenCalled();
  });

  it('explains a file it can’t use', async () => {
    picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://w.csv', name: 'w.csv' }],
    });
    api.importWorkoutsCsv.mockRejectedValue(new ApiError(422, 'validation_error', 'No'));
    await render(<DataSettings />);

    await fireEvent.press(screen.getByLabelText('Import workouts (CSV)'));

    expect(await screen.findByText(/didn’t work/)).toBeOnTheScreen();
  });
});

describe('Deleting the account', () => {
  async function open() {
    await render(<DataSettings />);
    await fireEvent.press(screen.getByLabelText('Delete my account'));
    return screen.findByLabelText(/Type DELETE/);
  }

  it('needs the word typed, then closes the account and signs out', async () => {
    api.closeAccount.mockResolvedValue(undefined);
    const field = await open();

    await fireEvent.changeText(field, 'delete');
    await fireEvent.press(screen.getByLabelText('Delete account'));
    expect(await screen.findByText('Type DELETE to confirm')).toBeOnTheScreen();
    expect(api.closeAccount).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(/Type DELETE\./), 'DELETE');
    await fireEvent.press(screen.getByLabelText('Delete account'));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(api.closeAccount).toHaveBeenCalled();
  });

  it('stays signed in if it fails', async () => {
    api.closeAccount.mockRejectedValue(OFFLINE);
    const field = await open();

    await fireEvent.changeText(field, 'DELETE');
    await fireEvent.press(screen.getByLabelText('Delete account'));

    expect(await screen.findByText(/needs a connection/)).toBeOnTheScreen();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('An import report', () => {
  it('reads naturally', () => {
    expect(
      describeImport({ imported: 1, duplicates: 0, unknown_exercises: [], invalid: ['x'] }),
    ).toBe('1 workout imported. 1 couldn’t be read.');
    expect(
      describeImport({
        imported: 0,
        duplicates: 0,
        unknown_exercises: ['A', 'B', 'C', 'D'],
        invalid: [],
      }),
    ).toContain('A, B, C.');
  });
});
