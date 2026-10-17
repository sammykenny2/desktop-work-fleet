# 2026-10-05 Native Google authorization

## Official evidence

- [Installed apps OAuth](https://developers.google.com/identity/protocols/oauth2/native-app): PKCE, external browser, state, authorization code, refresh. Desktop loopback still applies; the client_secret field is optional.
- [Loopback migration](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration): desktop clients can use loopback; it cannot be applied to iOS/Android clients.
- [userinfo](https://developers.google.com/identity/openid-connect/reference): obtain the immutable sub through HTTPS Bearer userinfo, rather than using the email as the account identifier.

## Decisions and boundaries

Windows uses ADR-021: the system browser and native token management. Phones use the sign-in SDK/callback each platform supports and cannot reuse desktop loopback.
No Google Cloud project was created and no real account was signed in this time; the official API evidence does not mean integration acceptance is complete.
