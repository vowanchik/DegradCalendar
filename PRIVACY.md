# PartyUp privacy policy

Last updated: November 27, 2026.

PartyUp helps groups of friends arrange gaming sessions. Its clients connect to a PartyUp server selected by the user. Each server is operated independently; the project maintainer does not automatically receive the accounts, events, or messages stored on another operator's server. This policy describes the software's data flows. The operator of your server is responsible for explaining its own hosting, access, retention, backups, and contact details.

## Information on your chosen server

Registration and use send your username, display name, password, optional avatar, friend requests and relationships, event details, attendance responses, chat messages, and reminder preferences to the selected server. Passwords are processed for authentication and stored as salted scrypt hashes. The server stores hashes of session tokens and uses the tokens to authenticate requests. Session tokens expire after 30 days unless revoked sooner.

Profile information is shown where needed for friendships, invitations, and event participation. Event details and chat messages are available to invited participants. Server operators can access their database and backups. Messages are not end-to-end encrypted. The server and hosting infrastructure necessarily process connection information such as IP addresses; additional access logging depends on the deployment.

Use HTTPS when connecting over an untrusted network. If you choose an HTTP server, traffic, including credentials and messages, is not encrypted in transit.

## Information stored on your device

Clients store the selected server address, interface preferences, notification settings, and session information. Windows uses Electron safeStorage for saved session credentials; Android uses Android Keystore-backed storage and iOS uses Keychain. Custom notification audio stays on the device. Mobile push configuration can send notification channel identifiers or sound filenames to the chosen server, but not the audio file itself.

Windows background notifications require the application to remain running, including in the system tray. Autostart and the desktop widget are controlled through application settings.

## External services

- Steam search: when you search for a game, your server forwards the search text to Valve's Steam Store service. Game covers are fetched by the client from Steam's content delivery network when displayed. Valve consequently receives network request information from the requesting server or device. PartyUp does not require your Steam password or access to your Steam account. See [Valve's privacy policy](https://store.steampowered.com/privacy_agreement/).
- Google Fonts: the current interface requests its font stylesheet and font files from Google's servers. This happens when the interface loads and can disclose your IP address and ordinary request headers to Google. There is currently no in-app switch to disable these requests. See the [Google Fonts FAQ](https://fonts.google.com/faq) and [Google privacy policy](https://policies.google.com/privacy).
- Mobile push: if your build and server are configured for Firebase and you enable mobile push, a device registration token, platform information, and notification configuration are registered with your server. The server sends notification titles and bodies, event and notification identifiers, and device tokens through Firebase Cloud Messaging; Apple Push Notification service is also involved on iOS. Notification text can appear on the lock screen according to your device settings. See [Firebase privacy information](https://firebase.google.com/support/privacy) and [Apple's privacy policy](https://www.apple.com/legal/privacy/).
- Downloads and support: visiting the GitHub repository, downloading releases, and filing issues use GitHub's services and are subject to [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

PartyUp contains no application analytics or crash-reporting integration in the reviewed source. The external requests described above still occur when the associated features or resources are used.

## Choices, retention, and requests

You can edit your profile, change your password, disable reminders and mobile push, sign out, or choose another server. Signing out clears local session access but does not delete your account, events, messages, or the server's backups. There is currently no self-service account deletion or data export feature.

Account and conversation records do not have a general automatic deletion period in the application. Contact the person who provided your server address for access, correction, deletion, retention, or backup questions. That operator must decide and disclose its retention and request-handling practices. Removing local application data does not remove data from the server or external services.

For general software questions, use the [project issue tracker](https://github.com/vowanchik/DegradCalendar/issues). Do not post passwords, session tokens, private conversations, or other private information in public issues.
