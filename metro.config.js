/* Expo's default transformer ships inlineRequires:false, so the whole startup
   import graph executes eagerly at launch. Inlining defers module execution to
   first use — smaller JS init, and the heavy webrtc/video route graphs only
   pay their cost on first navigation into them. */
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: true, inlineRequires: true },
})

/* Keep the demo fixture out of release bundles.

   src/mock/data.json is ~980 KB, and the handlers carry base64 MP4 data URIs
   on top of it. `if (__DEV__)` around the dynamic import in api/http.js does
   NOT strip it: Metro's collectDependencies pass registers every import() it
   sees while walking the AST, which happens BEFORE the constant folding that
   would drop the branch. The dependency edge is recorded either way, so the
   whole mock graph gets compiled into the shipped Hermes bytecode. Measured:
   the gate alone moved the bundle by -0.2%.

   The swap therefore has to happen at resolution time. `context.dev` is false
   for `expo export` and for release builds, true for the dev server — so mock
   mode keeps working everywhere it is actually used. */
const MOCK_INDEX = path.resolve(__dirname, 'src/mock/index.js')
const MOCK_STUB = path.resolve(__dirname, 'src/mock/index.prod.js')

const upstreamResolve = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest
  const resolved = resolve(context, moduleName, platform)
  if (
    context.dev === false
    && resolved
    && resolved.type === 'sourceFile'
    && path.resolve(resolved.filePath) === MOCK_INDEX
  ) {
    return { ...resolved, filePath: MOCK_STUB }
  }
  return resolved
}

module.exports = config
