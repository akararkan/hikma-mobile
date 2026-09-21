// =========================================================
// VideoComposerModule — Media3 Transformer concat/trim/speed.
//
// Mirrors the iOS contract exactly: compose(clips) → one
// exported .mp4 in the cache dir, each clip { uri, startMs?,
// endMs?, speed? }. Clipping rides MediaItem's own
// ClippingConfiguration; speed is SpeedChangeEffect (audio and
// video together, pitch shifting with the rate — the TikTok
// behaviour); order is the sequence order.
//
// Transformer must be BUILT and STARTED on a Looper thread —
// everything here hops to the main handler and resolves the
// promise from the listener.
// =========================================================
package expo.modules.videocomposer

import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

class ComposeClipRecord : Record {
  @Field var uri: String = ""
  @Field var startMs: Double? = null
  @Field var endMs: Double? = null
  @Field var speed: Double? = null
}

class VideoComposerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoComposer")

    AsyncFunction("compose") { clips: List<ComposeClipRecord>, promise: Promise ->
      if (clips.isEmpty()) {
        promise.reject(CodedException("E_COMPOSE", "No clips to compose.", null))
        return@AsyncFunction
      }
      val context = appContext.reactContext
        ?: run {
          promise.reject(CodedException("E_COMPOSE", "No context.", null))
          return@AsyncFunction
        }

      Handler(Looper.getMainLooper()).post {
        try {
          val items = clips.map { clip ->
            val mediaBuilder = MediaItem.Builder().setUri(clip.uri)
            val clipping = MediaItem.ClippingConfiguration.Builder()
            clip.startMs?.let { clipping.setStartPositionMs(it.toLong()) }
            clip.endMs?.let { clipping.setEndPositionMs(it.toLong()) }
            mediaBuilder.setClippingConfiguration(clipping.build())

            val edited = EditedMediaItem.Builder(mediaBuilder.build())
            val speed = clip.speed ?: 1.0
            if (speed > 0 && kotlin.math.abs(speed - 1.0) > 0.001) {
              val audio = SonicAudioProcessor().apply { setSpeed(speed.toFloat()) }
              edited.setEffects(
                Effects(listOf(audio), listOf(SpeedChangeEffect(speed.toFloat()))),
              )
            }
            edited.build()
          }

          val composition = Composition.Builder(EditedMediaItemSequence(items)).build()

          val out = File(context.cacheDir, "reel-compose-${System.currentTimeMillis()}.mp4")
          if (out.exists()) out.delete()

          val transformer = Transformer.Builder(context)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(comp: Composition, result: ExportResult) {
                promise.resolve(
                  mapOf(
                    "uri" to "file://${out.absolutePath}",
                    "durationMs" to (result.durationMs.takeIf { it > 0 } ?: 0L).toInt(),
                  ),
                )
              }

              override fun onError(comp: Composition, result: ExportResult, exception: ExportException) {
                promise.reject(CodedException("E_COMPOSE", exception.message ?: "Export failed.", exception))
              }
            })
            .build()

          transformer.start(composition, out.absolutePath)
        } catch (e: Throwable) {
          promise.reject(CodedException("E_COMPOSE", e.message ?: "Export failed.", e))
        }
      }
    }
  }
}
