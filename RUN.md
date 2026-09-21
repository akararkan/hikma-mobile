# How to run the app

## First time (or after adding/changing native modules)

```sh
npx expo prebuild --clean
```

## Android (physical device plugged in)

```sh
npx expo run:android
```

## iOS (simulator)

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run ios
```

## Just the dev server (app already installed on the phone)

```sh
npx expo start
```

Restart it with `npx expo start -c` after editing `.env` or metro.config.js.

## Notes

- Gradle is pinned to JDK 17 globally in `~/.gradle/gradle.properties`
  (`org.gradle.java.home=...`) — no JAVA_HOME export needed; your system
  Java stays 25.
- Physical device: `.env` must have your Mac's LAN IP (`ipconfig getifaddr en0`).
- Live streaming: the same IP must also be in the backend's `application.yaml`
  and `mediamtx.yml` (in `~/Desktop/irc`), then restart MediaMTX.
