/* =========================================================
   withNotifeeCoreOffline — Expo config plugin.

   notifee's own android/build.gradle declares its native core as
   `app.notifee:core:+` (a dynamic "any version" range) and ALSO
   vendors that exact AAR locally inside the npm package
   (android/libs/app/notifee/core/202108261754/), specifically so
   the build can resolve it without hitting the network — in
   theory. In practice it doesn't: notifee registers that local
   repo by calling `rootProject.allprojects { repositories {...} }`
   from INSIDE its own (subproject) build.gradle. Expo's gradle
   invocation always adds `--configure-on-demand`, and Gradle's
   docs call this exact pattern out as a known incompatibility —
   configure-on-demand can skip evaluating a subproject's build
   script for cross-project side effects like this one, so the
   local repo silently never gets registered at all. What's left
   is google()/mavenCentral()/jitpack (declared in THIS project's
   own build.gradle, always configured) — none of which reliably
   carry `app.notifee:core`, so resolution depends on network
   luck it shouldn't need to.

   Two independent fixes, applied together:

   1. Force the EXACT version already sitting in node_modules,
      instead of the dynamic "+" notifee's own build.gradle asks
      for. A pinned version is a single "does this file exist"
      lookup per repo; "+" needs Gradle to enumerate every version
      across every declared repo, which is both slower and the
      part that hard-fails on a single flaky repo.
   2. Register notifee's local `android/libs` folder as a repo
      directly in THIS (root) build.gradle — the one Gradle always
      configures — instead of trusting notifee's subproject script
      to do it.

   Together, resolving `app.notifee:core` never needs the network
   at all: the exact artifact is already on disk.

   Keep NOTIFEE_CORE_VERSION in sync with whatever version string
   names the folder under
   node_modules/@notifee/react-native/android/libs/app/notifee/core/
   — a notifee upgrade that moves this makes `expo prebuild`'s
   Android build fail loudly (unresolvable dependency), so there is
   no silent-staleness risk.
   ========================================================= */
const path = require('path')
const { withProjectBuildGradle } = require('@expo/config-plugins')

const NOTIFEE_CORE_VERSION = '202108261754'

module.exports = function withNotifeeCoreOffline(config) {
  return withProjectBuildGradle(config, config => {
    if (config.modResults.contents.includes('app.notifee:core:')) return config

    const notifeePkg = require.resolve('@notifee/react-native/package.json')
    const localLibsDir = path.join(path.dirname(notifeePkg), 'android', 'libs')

    config.modResults.contents += `
allprojects {
    repositories {
        maven { url uri('${localLibsDir}') }
    }
    configurations.all {
        resolutionStrategy {
            force 'app.notifee:core:${NOTIFEE_CORE_VERSION}'
        }
    }
}
`
    return config
  })
}
