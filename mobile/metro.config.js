const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Expo's defaults, plus the debug ids Sentry needs to match source maps.
const config = getSentryExpoConfig(__dirname);

// Drizzle migrations are imported as .sql files.
config.resolver.sourceExts.push('sql');

module.exports = config;
