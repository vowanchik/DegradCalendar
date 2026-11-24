import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.partyup.app',
  appName: 'PartyUp',
  webDir: 'dist',
  ios: { contentInset: 'automatic' },
  plugins: {
    CapacitorHttp: { enabled: true },
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
