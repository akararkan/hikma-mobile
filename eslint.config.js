// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    /* The window is edge-to-edge on Android (app.json), so it never resizes
       for the IME and `adjustResize` cannot save a layout. RN's own
       KeyboardAvoidingView has no Android implementation — with
       behavior={Platform.OS === 'ios' ? 'padding' : undefined} it degrades to
       a plain View and every docked composer sits under the keyboard. The
       controller's KAV measures the real frame on both platforms, so the
       house style is `behavior="padding"` unconditionally with
       keyboardVerticalOffset={0}. This rule exists because that import was
       written the wrong way three separate times. */
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "react-native",
          importNames: ["KeyboardAvoidingView"],
          message:
            "Import KeyboardAvoidingView from 'react-native-keyboard-controller' instead — " +
            "RN's is a no-op on Android under edge-to-edge. Use behavior=\"padding\" and keyboardVerticalOffset={0}.",
        }],
      }],
    },
  },
]);
