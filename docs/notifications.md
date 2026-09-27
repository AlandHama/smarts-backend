# Notifications and FCM setup

The notification inbox is Railway-authoritative. Every specific server event is
written to `Notification` and the mobile app polls that inbox. FCM is an
optional delivery adapter used to wake/show the same notification on registered
devices; a missing or unavailable FCM configuration does not remove the inbox
item.

## Railway variables

Configure these as private Railway variables. Do not put the service account in
the database, admin UI, Flutter project, or source control.

Either provide one JSON variable:

- `FIREBASE_SERVICE_ACCOUNT_JSON`

or provide the three values separately:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (keep escaped `\\n` line breaks if entered as one line)

The Firebase project must have the FCM HTTP v1 API enabled, and the service
account needs permission to send FCM messages to that project.

## Flutter platform configuration

The Flutter code now uses `firebase_core` and `firebase_messaging`, but the
Firebase project files are deliberately not fabricated here. Add the real
project configuration for the app package `com.pheonix.gaemverse`:

- Android: `android/app/google-services.json`
- iOS: `ios/Runner/GoogleService-Info.plist`, Push Notifications capability,
  Remote notifications background mode, and an APNs key uploaded in Firebase

After those files are present, the app requests notification permission after a
successful Railway login, registers the FCM token at
`POST /notifications/device-token`, refreshes the inbox for foreground pushes,
and opens the notification inbox when a push is tapped. Logout deactivates the
current device token.

Adding these native Firebase files/dependencies requires a new native app build;
a Shorebird Dart patch cannot add or configure a native Firebase plugin in an
already-installed APK.
