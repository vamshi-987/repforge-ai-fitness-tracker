import { foregroundBehavior, ONGOING_NOTIFICATION_ID, REST_NOTIFICATION_ID } from '../notifier';

describe('foregroundBehavior', () => {
  it('silences the rest notification while the app is open', () => {
    expect(foregroundBehavior(REST_NOTIFICATION_ID)).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
    });
  });

  it('keeps the workout notification in the tray without a banner', () => {
    expect(foregroundBehavior(ONGOING_NOTIFICATION_ID)).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
    });
  });

  it('shows anything else normally', () => {
    expect(foregroundBehavior('weekly-report')).toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
    });
  });
});
