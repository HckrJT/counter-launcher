# Counter Launcher: Microsoft-Anmeldung

The launcher uses Microsoft's OAuth 2.0 authorization-code flow with PKCE. The
sign-in page opens in the user's normal browser; no Microsoft client secret is
stored in the launcher. After Microsoft returns the token, the launcher
performs the Xbox Live, XSTS, and Minecraft Services exchanges needed to start
the game directly.

## Azure configuration

The packaged launcher already contains the approved application (client) ID
`bb5d17f5-97e1-4cb0-b2e8-de162f69470d`; players do not need an Azure account or
any Azure setting. Under **Accounts**, they can click **Mit Microsoft
anmelden** immediately.

For development or an internal fork, set `COUNTER_AZURE_CLIENT_ID` before
starting the launcher to override the bundled ID. Do not put a client secret
in the repository or the packaged launcher.

The registered app must use:

1. **Supported account types:** Personal Microsoft accounts only (consumer accounts).
2. **Authentication platform:** Mobile and desktop applications.
3. **Redirect URI:**
   `http://localhost:53682/auth/callback`
4. **Allow public client flows:** Yes.
5. **OAuth scopes requested by the launcher:** `XboxLive.signin offline_access`.

`XboxLive.signin` is not a normal Microsoft Graph permission and is not added
through the Graph permissions picker. The client ID must be approved for
Minecraft Services through [Minecraft's app review](https://aka.ms/mce-reviewappid);
otherwise the service can return HTTP 403.

The client ID is configuration, not a secret. Access and refresh tokens are
protected with Electron's OS-backed `safeStorage` (Windows DPAPI).

The callback uses local port `53682`; if another application occupies it,
close that application before signing in. The official Minecraft Launcher
option remains available when an Azure registration has not yet been approved.
