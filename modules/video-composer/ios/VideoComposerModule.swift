// =========================================================
// VideoComposerModule — AVFoundation concat / trim / speed.
//
// One entry point: compose(clips) → one exported .mp4 in the
// caches directory. Each clip is { uri, startMs?, endMs?,
// speed? }; clips are trimmed, retimed (scaleTimeRange — the
// audio pitch shifts with the rate, the TikTok behaviour) and
// appended in order.
//
// Orientation: every camera clip carries its rotation in
// preferredTransform, and a naive concat renders sideways. A
// per-segment AVMutableVideoComposition instruction applies
// each clip's own transform, normalised into the render box of
// the FIRST clip's oriented size — mixed portrait/landscape
// imports letterbox rather than stretch.
// =========================================================
import AVFoundation
import ExpoModulesCore

struct ComposeClipRecord: Record {
  @Field var uri: String = ""
  @Field var startMs: Double?
  @Field var endMs: Double?
  @Field var speed: Double?
}

public class VideoComposerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoComposer")

    AsyncFunction("compose") { (clips: [ComposeClipRecord], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try self.composeClips(clips)
          promise.resolve(result)
        } catch let error {
          promise.reject("E_COMPOSE", error.localizedDescription)
        }
      }
    }
  }

  private enum ComposeError: LocalizedError {
    case noClips, noVideoTrack(String), exportFailed(String), cannotAddTrack
    var errorDescription: String? {
      switch self {
      case .noClips: return "No clips to compose."
      case .noVideoTrack(let uri): return "No video track in \(uri)."
      case .exportFailed(let why): return "Export failed: \(why)."
      case .cannotAddTrack: return "Could not create composition tracks."
      }
    }
  }

  private func orientedSize(_ track: AVAssetTrack) -> CGSize {
    let size = track.naturalSize.applying(track.preferredTransform)
    return CGSize(width: abs(size.width), height: abs(size.height))
  }

  private func composeClips(_ clips: [ComposeClipRecord]) throws -> [String: Any] {
    guard !clips.isEmpty else { throw ComposeError.noClips }

    let composition = AVMutableComposition()
    guard
      let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw ComposeError.cannotAddTrack }

    var instructions: [AVMutableVideoCompositionInstruction] = []
    var cursor = CMTime.zero
    var renderSize = CGSize.zero
    var maxFps: Float = 30

    for clip in clips {
      guard let url = URL(string: clip.uri) ?? URL(string: "file://\(clip.uri)") else { continue }
      let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
      guard let srcVideo = asset.tracks(withMediaType: .video).first else {
        throw ComposeError.noVideoTrack(clip.uri)
      }
      let srcAudio = asset.tracks(withMediaType: .audio).first
      if renderSize == .zero { renderSize = orientedSize(srcVideo) }
      maxFps = max(maxFps, srcVideo.nominalFrameRate)

      let assetDur = asset.duration
      let start = CMTime(seconds: max(0, (clip.startMs ?? 0) / 1000.0), preferredTimescale: 600)
      let rawEnd = clip.endMs.map { CMTime(seconds: $0 / 1000.0, preferredTimescale: 600) } ?? assetDur
      let end = CMTimeMinimum(rawEnd, assetDur)
      guard CMTimeCompare(end, start) > 0 else { continue }
      let range = CMTimeRange(start: start, end: end)

      try videoTrack.insertTimeRange(range, of: srcVideo, at: cursor)
      if let srcAudio = srcAudio {
        try? audioTrack.insertTimeRange(range, of: srcAudio, at: cursor)
      }

      var segDuration = range.duration
      let speed = clip.speed ?? 1.0
      if speed > 0, abs(speed - 1.0) > 0.001 {
        let scaled = CMTime(seconds: segDuration.seconds / speed, preferredTimescale: 600)
        let inserted = CMTimeRange(start: cursor, duration: segDuration)
        videoTrack.scaleTimeRange(inserted, toDuration: scaled)
        audioTrack.scaleTimeRange(inserted, toDuration: scaled)
        segDuration = scaled
      }

      // Per-segment orientation, normalised into the first clip's box.
      let instruction = AVMutableVideoCompositionInstruction()
      instruction.timeRange = CMTimeRange(start: cursor, duration: segDuration)
      let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
      let oriented = orientedSize(srcVideo)
      let fit = min(renderSize.width / max(oriented.width, 1), renderSize.height / max(oriented.height, 1))
      let dx = (renderSize.width - oriented.width * fit) / 2
      let dy = (renderSize.height - oriented.height * fit) / 2
      let transform = srcVideo.preferredTransform
        .concatenating(CGAffineTransform(scaleX: fit, y: fit))
        .concatenating(CGAffineTransform(translationX: dx, y: dy))
      layer.setTransform(transform, at: cursor)
      instruction.layerInstructions = [layer]
      instructions.append(instruction)

      cursor = CMTimeAdd(cursor, segDuration)
    }

    guard CMTimeCompare(cursor, .zero) > 0 else { throw ComposeError.noClips }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = instructions
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(24, min(60, Int32(maxFps)))))

    let outUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("reel-compose-\(Int(Date().timeIntervalSince1970 * 1000)).mp4")
    try? FileManager.default.removeItem(at: outUrl)

    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw ComposeError.exportFailed("no export session")
    }
    export.outputURL = outUrl
    export.outputFileType = .mp4
    export.videoComposition = videoComposition
    export.shouldOptimizeForNetworkUse = true

    let semaphore = DispatchSemaphore(value: 0)
    export.exportAsynchronously { semaphore.signal() }
    semaphore.wait()

    if export.status != .completed {
      throw ComposeError.exportFailed(export.error?.localizedDescription ?? "status \(export.status.rawValue)")
    }

    return [
      "uri": outUrl.absoluteString,
      "durationMs": Int(cursor.seconds * 1000.0),
    ]
  }
}
