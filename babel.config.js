/* =========================================================
   Why this file exists (Expo runs fine without one):

   · react-native-boost — build-time swap of statically safe
     <View>/<Text> call sites for their raw native components,
     skipping the JS wrapper work on every render (kuatsu.de
     measured up to ~50% on Text, ~33% on View). NATIVE ONLY:
     react-native-web does not ship the internal NativeText /
     NativeView the swap targets, so the web platform keeps the
     stock transform. A call site the plugin cannot prove safe
     is left untouched; `// @boost-ignore` opts a line out.

   · transform-remove-console — release bundles drop console
     noise. error/warn survive: they are the only breadcrumbs a
     production incident leaves.

   Plugin order matters and is free here: Babel runs config
   plugins BEFORE presets, and babel-preset-expo carries the
   React Compiler + worklets plugins — so boost rewrites JSX
   first and the compiler memoizes the result.
   ========================================================= */
module.exports = function (api) {
  /* api.caller() keys the config cache on the value it returns, so the
     platform split is cache-correct without touching api.cache. */
  const isWeb = api.caller(c => !!c && c.platform === 'web')

  return {
    presets: ['babel-preset-expo'],
    plugins: isWeb ? [] : [['react-native-boost/plugin', {}]],
    env: {
      production: {
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
      },
    },
  }
}
