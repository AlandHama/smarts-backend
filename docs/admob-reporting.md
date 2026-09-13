# AdMob reporting setup

The System Admin AdMob page uses the Google AdMob API's OAuth 2.0 web flow and
the `admob.report`/`admob.readonly` scopes. Google credentials and refresh
tokens stay in the NestJS service; they are never shipped to Flutter or the
browser after authorization.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable the AdMob API.
3. Configure the OAuth consent screen. Publish it or add the administrator
   Google account as a test user while the app is in testing.
4. Create a **Web application** OAuth client.
5. Add this callback URL exactly:

   ```text
   https://YOUR_RAILWAY_DOMAIN/system-admin/api/admob/oauth/callback
   ```

6. Download the client ID and client secret.

The Google account used during **Connect AdMob with Google** must have access
to the target AdMob publisher account. If `ADMOB_PUBLISHER_ID` is provided,
the selected account must match it; otherwise the first account returned by
Google is selected.

## Railway variables

Set these variables on the NestJS Railway service:

```text
ADMOB_GOOGLE_CLIENT_ID=...
ADMOB_GOOGLE_CLIENT_SECRET=...
ADMOB_OAUTH_REDIRECT_URI=https://YOUR_RAILWAY_DOMAIN/system-admin/api/admob/oauth/callback
ADMOB_TOKEN_ENCRYPTION_KEY=<random long secret>
ADMOB_OAUTH_STATE_SECRET=<random long secret>
```

Optional:

```text
ADMOB_PUBLISHER_ID=pub-...
```

`ADMOB_TOKEN_ENCRYPTION_KEY` encrypts the stored Google refresh token with
AES-256-GCM. Keep it stable; changing it makes the existing connection
unreadable and requires reconnecting AdMob. `ADMOB_OAUTH_STATE_SECRET`
protects the OAuth callback state and should also remain stable.

## Synchronization behavior

The backend synchronizes the most recent three days once per hour. Recent days
are intentionally re-imported because AdMob may revise report values. A manual
**Sync now** from the AdMob tab imports the selected period, with at least 30
days on the first/manual refresh.

The report stores daily rows grouped by date, app, platform, country, format,
and ad unit. It includes requests, matched requests, impressions, clicks,
estimated earnings, impression CTR, impression RPM, match rate, and show rate.
Verified Railway rewarded-ad claims are shown alongside the AdMob metrics.

AdMob report earnings are estimates and are kept in integer micros in the
database. The UI formats them using the account currency returned by AdMob.
