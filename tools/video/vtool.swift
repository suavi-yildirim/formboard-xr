// Small video tool on AVFoundation, for editing the Quest 3 recordings (no ffmpeg needed).
// Build: swiftc -O tools/video/vtool.swift -o /tmp/vtool   (outputs: keep raw recordings out of git)
//   vtool probe <in>                                              duration, tracks, size, fps
//   vtool sheet <in> <out.jpg> <start> <end> <count> [cols]       contact sheet with timestamps
//   vtool motion <in> <start> <end> <step>                        camera motion per step (pick calm takes)
//   vtool cut <in> <out.mp4> <ranges "s-e,s-e"> [preset]          join ranges, Apple preset (large files)
//   vtool encode <in> <out.mp4> <ranges> <w> <h> <kbps> [fps]     join ranges, H.264 + AAC at a set bitrate (fps: drop to it)
//   vtool montage <in> <out.mp4> <ranges> <fade> <w> <h> <kbps>   like encode, with cross-fades (video + audio);
//                                                                  a range "s-e@x:y:w" also crops it to the 16:9 box
//                                                                  at source pixel x, y (top left) with width w;
//                                                                  a trailing "*0.5" plays the range at half speed;
//                                                                  a trailing "!" joins it to the next range without a fade
//   vtool caption <in> <out.mp4> <captions.json> <kbps> [hold s]  burn in captions (see the caption case); hold
//                                                                  repeats the last frame (with its captions) at the end
//   vtool stabilize <in> <out.mp4> <kbps> [window s] [zoom]       smooth the camera path (see the stabilize case)
//   vtool levels <in> <step>                                      audio loudness per step (look for voices)
//   vtool gif <in> <out.gif> <width> <fps> [start] [end]          looping GIF (for the README)
//   vtool frame <in> <out.jpg|.png> <sec> [full]                  poster image (full: video size)
import AVFoundation
import AppKit
import CoreImage
import Vision

func fail(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(1) }

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: vtool probe|sheet|motion|cut|encode|montage|gif|frame ...") }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[2]))

func load<T>(_ f: @escaping () async throws -> T) -> T {
  var out: T?
  var err: Error?
  let sem = DispatchSemaphore(value: 0)
  Task { do { out = try await f() } catch { err = error }; sem.signal() }
  sem.wait()
  if let e = err { fail("\(e)") }
  return out!
}

switch args[1] {
case "probe":
  let dur = load { try await asset.load(.duration) }
  let tracks = load { try await asset.load(.tracks) }
  print(String(format: "duration %.1f s", dur.seconds))
  for t in tracks {
    let size = load { try await t.load(.naturalSize) }
    let fps = load { try await t.load(.nominalFrameRate) }
    let tf = load { try await t.load(.preferredTransform) }
    print("track \(t.mediaType.rawValue) size \(Int(size.width))x\(Int(size.height)) fps \(fps) transform \(tf.a),\(tf.b),\(tf.c),\(tf.d)")
  }

case "sheet":
  let out = args[3], start = Double(args[4])!, end = Double(args[5])!, count = Int(args[6])!
  let cols = args.count > 7 ? Int(args[7])! : 4
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  gen.maximumSize = CGSize(width: 480, height: 480)
  gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
  gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
  var images: [(Double, CGImage)] = []
  for i in 0..<count {
    let t = count == 1 ? start : start + (end - start) * Double(i) / Double(count - 1)
    if let img = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) { images.append((t, img)) }
  }
  guard let first = images.first?.1 else { fail("no frames") }
  let w = first.width, h = first.height, rows = (images.count + cols - 1) / cols
  let ctx = CGContext(data: nil, width: w * cols, height: h * rows, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(gray: 0, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w * cols, height: h * rows))
  NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
  for (i, (t, img)) in images.enumerated() {
    let x = (i % cols) * w, y = (rows - 1 - i / cols) * h
    ctx.draw(img, in: CGRect(x: x, y: y, width: w, height: h))
    let label = String(format: "%d:%04.1f", Int(t) / 60, t.truncatingRemainder(dividingBy: 60)) as NSString
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 22), .foregroundColor: NSColor.yellow, .backgroundColor: NSColor.black]
    label.draw(at: CGPoint(x: x + 6, y: y + 6), withAttributes: attrs)
  }
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: out))
  print("wrote \(out) (\(images.count) frames)")

case "cut":
  // cut <in> <out.mp4> <ranges "s-e,s-e,..."> [preset]: joins the ranges, keeps video and audio
  let out = URL(fileURLWithPath: args[3])
  let ranges = args[4].split(separator: ",").map { r -> CMTimeRange in
    let se = r.split(separator: "-").map { Double($0)! }
    return CMTimeRange(start: CMTime(seconds: se[0], preferredTimescale: 600), end: CMTime(seconds: se[1], preferredTimescale: 600))
  }
  let preset = args.count > 5 ? args[5] : AVAssetExportPreset1280x720
  let comp = AVMutableComposition()
  for type in [AVMediaType.video, .audio] {
    guard let src = load({ try await asset.loadTracks(withMediaType: type) }).first else { continue }
    let dst = comp.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)!
    var at = CMTime.zero
    for r in ranges { try! dst.insertTimeRange(r, of: src, at: at); at = at + r.duration }
    if type == .video { dst.preferredTransform = load { try await src.load(.preferredTransform) } }
  }
  try? FileManager.default.removeItem(at: out)
  let ex = AVAssetExportSession(asset: comp, presetName: preset)!
  ex.outputURL = out
  ex.outputFileType = .mp4
  ex.shouldOptimizeForNetworkUse = true
  let sem = DispatchSemaphore(value: 0)
  ex.exportAsynchronously { sem.signal() }
  sem.wait()
  if ex.status != .completed { fail("export failed: \(String(describing: ex.error))") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %.1f s)", out.lastPathComponent, Double(bytes) / 1e6, comp.duration.seconds))

case "encode":
  // encode <in> <out.mp4> <ranges> <width> <height> <kbps>: like cut, with explicit H.264 bitrate + AAC
  let out = URL(fileURLWithPath: args[3])
  let ranges = args[4].split(separator: ",").map { r -> CMTimeRange in
    let se = r.split(separator: "-").map { Double($0)! }
    return CMTimeRange(start: CMTime(seconds: se[0], preferredTimescale: 600), end: CMTime(seconds: se[1], preferredTimescale: 600))
  }
  let w = Int(args[5])!, h = Int(args[6])!, kbps = Int(args[7])!
  let fpsOut = args.count > 8 ? Double(args[8])! : 0 // 0: keep every frame
  let comp = AVMutableComposition()
  var hasAudio = false
  for type in [AVMediaType.video, .audio] {
    guard let src = load({ try await asset.loadTracks(withMediaType: type) }).first else { continue }
    let dst = comp.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)!
    var at = CMTime.zero
    for r in ranges { try! dst.insertTimeRange(r, of: src, at: at); at = at + r.duration }
    if type == .audio { hasAudio = true }
  }
  let reader = try! AVAssetReader(asset: comp)
  let vTrack = comp.tracks(withMediaType: .video)[0]
  let vOut = AVAssetReaderTrackOutput(track: vTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
  reader.add(vOut)
  var aOut: AVAssetReaderTrackOutput?
  if hasAudio {
    let o = AVAssetReaderTrackOutput(track: comp.tracks(withMediaType: .audio)[0], outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
    reader.add(o); aOut = o
  }
  try? FileManager.default.removeItem(at: out)
  let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
  writer.shouldOptimizeForNetworkUse = true
  let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
    AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
  vIn.expectsMediaDataInRealTime = false
  writer.add(vIn)
  var aIn: AVAssetWriterInput?
  if hasAudio {
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000])
    writer.add(i); aIn = i
  }
  reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
  let group = DispatchGroup()
  func pump(_ input: AVAssetWriterInput, _ output: AVAssetReaderTrackOutput, _ q: String) {
    group.enter()
    input.requestMediaDataWhenReady(on: DispatchQueue(label: q)) {
      while input.isReadyForMoreMediaData {
        if let b = output.copyNextSampleBuffer() { input.append(b) } else { input.markAsFinished(); group.leave(); return }
      }
    }
  }
  if fpsOut > 0 {
    // keep one frame per 1/fps slot (60 -> 30 fps keeps every second frame)
    var next = 0.0
    group.enter()
    vIn.requestMediaDataWhenReady(on: DispatchQueue(label: "v")) {
      while vIn.isReadyForMoreMediaData {
        guard let b = vOut.copyNextSampleBuffer() else { vIn.markAsFinished(); group.leave(); return }
        let t = CMSampleBufferGetPresentationTimeStamp(b).seconds
        if t + 0.002 >= next { vIn.append(b); next += 1 / fpsOut; while next <= t { next += 1 / fpsOut } }
      }
    }
  } else {
    pump(vIn, vOut, "v")
  }
  if let i = aIn, let o = aOut { pump(i, o, "a") }
  group.wait()
  let sem = DispatchSemaphore(value: 0)
  writer.finishWriting { sem.signal() }
  sem.wait()
  if writer.status != .completed { fail("encode failed: \(String(describing: writer.error))") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %.1f s)", out.lastPathComponent, Double(bytes) / 1e6, comp.duration.seconds))

case "motion":
  // motion <in> <start> <end> <step>: camera motion per step = mean abs difference of tiny grey frames
  let start = Double(args[3])!, end = Double(args[4])!, step = Double(args[5])!
  let reader = try! AVAssetReader(asset: asset)
  let vt = load { try await asset.loadTracks(withMediaType: .video) }.first!
  let out = AVAssetReaderTrackOutput(track: vt, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange])
  out.alwaysCopiesSampleData = false
  reader.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), end: CMTime(seconds: end, preferredTimescale: 600))
  reader.add(out)
  reader.startReading()
  var prev: [Float]? = nil, nextT = start
  var line = ""
  while let sb = out.copyNextSampleBuffer() {
    let t = CMSampleBufferGetPresentationTimeStamp(sb).seconds
    if t < nextT { continue }
    nextT += step
    guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0), bpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
    let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0)!.assumingMemoryBound(to: UInt8.self)
    var g = [Float](repeating: 0, count: 64 * 36)
    for y in 0..<36 { for x in 0..<64 { g[y * 64 + x] = Float(base[(y * h / 36) * bpr + (x * w / 64)]) } }
    CVPixelBufferUnlockBaseAddress(pb, .readOnly)
    if let p = prev {
      var d: Float = 0
      for i in 0..<g.count { d += abs(g[i] - p[i]) }
      line += String(format: "%.1f:%.0f ", t, d / Float(g.count))
    }
    prev = g
  }
  print(line)

case "montage":
  // montage <in> <out.mp4> <ranges> <fadeSec> <width> <height> <kbps>: ranges joined with cross-fades
  // (video dissolve and audio cross-fade), H.264 + AAC at an explicit bitrate.
  let out = URL(fileURLWithPath: args[3])
  let srcV = load { try await asset.loadTracks(withMediaType: .video) }.first!
  let srcA = load { try await asset.loadTracks(withMediaType: .audio) }.first
  let natural = load { try await srcV.load(.naturalSize) }
  var crops: [CGAffineTransform] = []
  var speeds: [Double] = []
  var joins: [Bool] = []
  let ranges = args[4].split(separator: ",").map { item0 -> CMTimeRange in
    joins.append(item0.hasSuffix("!"))
    let whole = item0.hasSuffix("!") ? item0.dropLast() : item0
    let sp = whole.split(separator: "*")
    speeds.append(sp.count > 1 ? Double(sp[1])! : 1)
    let item = sp[0]
    let parts = item.split(separator: "@")
    let se = parts[0].split(separator: "-").map { Double($0)! }
    var t = CGAffineTransform.identity
    if parts.count > 1 {
      // crop box (top-left x, y and width in source pixels, 16:9), scaled up to fill the frame
      let c = parts[1].split(separator: ":").map { Double($0)! }
      let k = natural.width / c[2]
      t = CGAffineTransform(a: k, b: 0, c: 0, d: k, tx: -c[0] * k, ty: -c[1] * k)
    }
    crops.append(t)
    return CMTimeRange(start: CMTime(seconds: se[0], preferredTimescale: 600), end: CMTime(seconds: se[1], preferredTimescale: 600))
  }
  let fade0 = CMTime(seconds: Double(args[5])!, preferredTimescale: 600)
  // fade after range i (into range i + 1): none after the last range or a joined one
  let fades = (0..<ranges.count).map { i in i < ranges.count - 1 && !joins[i] ? fade0 : CMTime.zero }
  let w = Int(args[6])!, h = Int(args[7])!, kbps = Int(args[8])!
  let comp = AVMutableComposition()
  let lanes = min(2, ranges.count)
  let vT = (0..<lanes).map { _ in comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)! }
  let aT = srcA == nil ? [] : (0..<lanes).map { _ in comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)! }
  var segs: [(start: CMTime, end: CMTime, lane: Int)] = []
  var cursor = CMTime.zero
  for (i, r) in ranges.enumerated() {
    let lane = i % lanes
    try! vT[lane].insertTimeRange(r, of: srcV, at: cursor)
    if let a = srcA { try! aT[lane].insertTimeRange(r, of: a, at: cursor) }
    let dur = CMTime(seconds: r.duration.seconds / speeds[i], preferredTimescale: 600)
    if speeds[i] != 1 {
      vT[lane].scaleTimeRange(CMTimeRange(start: cursor, duration: r.duration), toDuration: dur)
      if srcA != nil { aT[lane].scaleTimeRange(CMTimeRange(start: cursor, duration: r.duration), toDuration: dur) }
    }
    segs.append((cursor, cursor + dur, lane))
    cursor = cursor + dur - fades[i]
  }
  let total = segs.last!.end
  let vc = AVMutableVideoComposition()
  vc.renderSize = natural
  vc.frameDuration = CMTime(value: 1, timescale: 60)
  var instructions: [AVMutableVideoCompositionInstruction] = []
  let mix = AVMutableAudioMix()
  var params = aT.map { AVMutableAudioMixInputParameters(track: $0) }
  for (i, s) in segs.enumerated() {
    let inStart = i > 0 ? s.start + fades[i - 1] : s.start
    let outStart = s.end - fades[i]
    let solo = AVMutableVideoCompositionInstruction()
    solo.timeRange = CMTimeRange(start: inStart, end: outStart)
    let soloLayer = AVMutableVideoCompositionLayerInstruction(assetTrack: vT[s.lane])
    soloLayer.setTransform(crops[i], at: inStart)
    solo.layerInstructions = [soloLayer]
    instructions.append(solo)
    if fades[i] > .zero {
      let next = segs[i + 1]
      let tr = CMTimeRange(start: outStart, end: s.end)
      let x = AVMutableVideoCompositionInstruction()
      x.timeRange = tr
      let outgoing = AVMutableVideoCompositionLayerInstruction(assetTrack: vT[s.lane])
      outgoing.setOpacityRamp(fromStartOpacity: 1, toEndOpacity: 0, timeRange: tr)
      outgoing.setTransform(crops[i], at: tr.start)
      let incoming = AVMutableVideoCompositionLayerInstruction(assetTrack: vT[next.lane])
      incoming.setTransform(crops[i + 1], at: tr.start)
      x.layerInstructions = [outgoing, incoming]
      instructions.append(x)
      if !params.isEmpty {
        params[s.lane].setVolumeRamp(fromStartVolume: 1, toEndVolume: 0, timeRange: tr)
        params[next.lane].setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: tr)
      }
    }
  }
  vc.instructions = instructions
  mix.inputParameters = params

  let reader = try! AVAssetReader(asset: comp)
  reader.timeRange = CMTimeRange(start: .zero, end: total)
  let vOut = AVAssetReaderVideoCompositionOutput(videoTracks: vT, videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  vOut.videoComposition = vc
  reader.add(vOut)
  var aOut: AVAssetReaderAudioMixOutput?
  if !aT.isEmpty {
    let o = AVAssetReaderAudioMixOutput(audioTracks: aT, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
    o.audioMix = mix
    reader.add(o); aOut = o
  }
  try? FileManager.default.removeItem(at: out)
  let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
  writer.shouldOptimizeForNetworkUse = true
  let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
    AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
  writer.add(vIn)
  var aIn: AVAssetWriterInput?
  if aOut != nil {
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000])
    writer.add(i); aIn = i
  }
  reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
  let group = DispatchGroup()
  func pump(_ input: AVAssetWriterInput, _ next: @escaping () -> CMSampleBuffer?, _ q: String) {
    group.enter()
    input.requestMediaDataWhenReady(on: DispatchQueue(label: q)) {
      while input.isReadyForMoreMediaData {
        if let b = next() { input.append(b) } else { input.markAsFinished(); group.leave(); return }
      }
    }
  }
  pump(vIn, { vOut.copyNextSampleBuffer() }, "v")
  if let i = aIn, let o = aOut { pump(i, { o.copyNextSampleBuffer() }, "a") }
  group.wait()
  let sem2 = DispatchSemaphore(value: 0)
  writer.finishWriting { sem2.signal() }
  sem2.wait()
  if writer.status != .completed || reader.status == .failed { fail("montage failed: \(String(describing: writer.error ?? reader.error))") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %.1f s)", out.lastPathComponent, Double(bytes) / 1e6, total.seconds))

case "caption":
  // caption <in> <out.mp4> <captions.json> <kbps>: re-encode with captions drawn onto the frames.
  // JSON: [{"s": start, "e": end, "t": "title", "d": "second line", "card": false}], times in seconds of <in>.
  // A logo entry: {"s", "e", "t": "", "img": "file.png", "pos": "tl" | "tr", "h": height in 1280-wide px,
  // "badge": true for a white rounded plate behind it}.
  // "f": fade time in seconds (default 0.35). "style": "chip" (pill at the top centre, e.g. a step name), "stamp" (pill that pops in below it; "colour":
  // "ok" | "err"), "bar" (progress line along the bottom from s to e, with "marks" as fractions for chapters).
  // Normal captions are a dark box at the bottom left with a cyan bar; "card": true dims the frame and
  // centres the text (title cards). Each fades in and out over 0.35 s.
  struct Cap: Decodable { let s: Double; let e: Double; let t: String; let d: String?; let card: Bool?
                          let img: String?; let pos: String?; let h: Double?; let badge: Bool?
                          let style: String?; let colour: String?; let marks: [Double]?; let f: Double? }
  var images: [String: CGImage] = [:]
  func image(_ path: String) -> CGImage {
    if let i = images[path] { return i }
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let i = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("cannot read image \(path)") }
    images[path] = i
    return i
  }
  let out = URL(fileURLWithPath: args[3])
  let caps = try! JSONDecoder().decode([Cap].self, from: Data(contentsOf: URL(fileURLWithPath: args[4])))
  let kbps = Int(args[5])!
  let hold = args.count > 6 ? Double(args[6])! : 0
  let srcV = load { try await asset.loadTracks(withMediaType: .video) }.first!
  let srcA = load { try await asset.loadTracks(withMediaType: .audio) }.first
  let size = load { try await srcV.load(.naturalSize) }
  let reader = try! AVAssetReader(asset: asset)
  let vOut = AVAssetReaderTrackOutput(track: srcV, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  reader.add(vOut)
  var aOut: AVAssetReaderTrackOutput?
  if let a = srcA { let o = AVAssetReaderTrackOutput(track: a, outputSettings: nil); reader.add(o); aOut = o }
  try? FileManager.default.removeItem(at: out)
  let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
  writer.shouldOptimizeForNetworkUse = true
  let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
  writer.add(vIn)
  var aIn: AVAssetWriterInput?
  if let a = srcA {
    let fmt = load { try await a.load(.formatDescriptions) }.first
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: fmt)
    writer.add(i); aIn = i
  }
  let W = size.width, H = size.height, u = W / 1280 // layout in 1280-wide units
  func font(_ px: CGFloat, _ bold: Bool) -> CTFont { CTFontCreateWithName((bold ? "HelveticaNeue-Bold" : "HelveticaNeue") as CFString, px * u, nil) }
  func line(_ text: String, _ f: CTFont, _ c: CGColor) -> CTLine {
    CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: f, .foregroundColor: c]))
  }
  func width(_ l: CTLine) -> CGFloat { CGFloat(CTLineGetTypographicBounds(l, nil, nil, nil)) }
  func draw(_ ctx: CGContext, _ cap: Cap, _ alpha: CGFloat, _ t: Double) {
    ctx.saveGState(); ctx.setAlpha(alpha)
    if cap.style == "bar" {
      let p = CGFloat((t - cap.s) / (cap.e - cap.s)), hgt = 6 * u
      ctx.setFillColor(CGColor(red: 0.05, green: 0.07, blue: 0.1, alpha: 0.7)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: hgt))
      ctx.setFillColor(CGColor(red: 0.36, green: 0.88, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: W * p, height: hgt))
      ctx.setFillColor(CGColor(gray: 1, alpha: 0.9))
      for m in cap.marks ?? [] { ctx.fill(CGRect(x: W * CGFloat(m) - u, y: 0, width: 2 * u, height: hgt + 3 * u)) }
      ctx.restoreGState(); return
    }
    if cap.style == "chip" || cap.style == "stamp" {
      let stamp = cap.style == "stamp"
      let l = line(cap.t, font(stamp ? 28 : 21, true), CGColor(gray: 1, alpha: 1))
      let tw = width(l), padX = (stamp ? 22 : 18) * u, bh = (stamp ? 50 : 38) * u
      let cy = H - (stamp ? 104 : 46) * u
      let k: CGFloat = stamp ? 1 + 0.3 * CGFloat(max(0, 1 - (t - cap.s) / 0.18)) : 1 // pop in
      ctx.translateBy(x: W / 2, y: cy); ctx.scaleBy(x: k, y: k)
      let box = CGRect(x: -tw / 2 - padX, y: -bh / 2, width: tw + 2 * padX, height: bh)
      let bg = cap.colour == "ok" ? CGColor(red: 0.13, green: 0.62, blue: 0.33, alpha: 0.95)
             : cap.colour == "err" ? CGColor(red: 0.85, green: 0.2, blue: 0.17, alpha: 0.95)
             : CGColor(red: 0.05, green: 0.07, blue: 0.1, alpha: 0.82)
      ctx.setFillColor(bg)
      ctx.addPath(CGPath(roundedRect: box, cornerWidth: bh / 2, cornerHeight: bh / 2, transform: nil)); ctx.fillPath()
      if !stamp {
        ctx.setStrokeColor(CGColor(red: 0.36, green: 0.88, blue: 1, alpha: 0.9)); ctx.setLineWidth(1.5 * u)
        ctx.addPath(CGPath(roundedRect: box, cornerWidth: bh / 2, cornerHeight: bh / 2, transform: nil)); ctx.strokePath()
      }
      ctx.textPosition = CGPoint(x: -tw / 2, y: -(stamp ? 10 : 7.5) * u); CTLineDraw(l, ctx)
      ctx.restoreGState(); return
    }
    if let path = cap.img {
      let img = image(path)
      let h = CGFloat(cap.h ?? 60) * u, w = h * CGFloat(img.width) / CGFloat(img.height)
      let m = 28 * u, pad = cap.badge == true ? 12 * u : 0
      let x = cap.pos == "tr" ? W - m - w - pad : m + pad, y = H - m - h - pad
      if cap.badge == true {
        ctx.setFillColor(CGColor(gray: 1, alpha: 0.94))
        ctx.addPath(CGPath(roundedRect: CGRect(x: x - pad, y: y - pad, width: w + 2 * pad, height: h + 2 * pad), cornerWidth: 10 * u, cornerHeight: 10 * u, transform: nil))
        ctx.fillPath()
      }
      ctx.interpolationQuality = .high
      ctx.draw(img, in: CGRect(x: x, y: y, width: w, height: h))
      ctx.restoreGState()
      return
    }
    let title = line(cap.t, font(cap.card == true ? 46 : 34, true), CGColor(gray: 1, alpha: 1))
    let sub = cap.d.map { line($0, font(cap.card == true ? 28 : 24, false), CGColor(red: 0.78, green: 0.83, blue: 0.9, alpha: 1)) }
    if cap.card == true {
      ctx.setFillColor(CGColor(red: 0.04, green: 0.06, blue: 0.09, alpha: 0.62)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
      ctx.textPosition = CGPoint(x: (W - width(title)) / 2, y: H / 2 + 6 * u); CTLineDraw(title, ctx)
      if let s = sub { ctx.textPosition = CGPoint(x: (W - width(s)) / 2, y: H / 2 - 40 * u); CTLineDraw(s, ctx) }
      ctx.setFillColor(CGColor(red: 0.36, green: 0.88, blue: 1, alpha: 1))
      ctx.fill(CGRect(x: W / 2 - 40 * u, y: H / 2 + 66 * u, width: 80 * u, height: 4 * u))
    } else {
      let pad = 18 * u, x = 40 * u, y = 40 * u
      let bw = max(width(title), sub.map(width) ?? 0) + 2 * pad + 8 * u
      let bh = (sub == nil ? 34 : 70) * u + 2 * pad
      let box = CGRect(x: x, y: y, width: bw, height: bh)
      ctx.setFillColor(CGColor(red: 0.05, green: 0.07, blue: 0.1, alpha: 0.78))
      ctx.addPath(CGPath(roundedRect: box, cornerWidth: 12 * u, cornerHeight: 12 * u, transform: nil)); ctx.fillPath()
      ctx.setFillColor(CGColor(red: 0.36, green: 0.88, blue: 1, alpha: 1))
      ctx.fill(CGRect(x: x, y: y + 12 * u, width: 5 * u, height: bh - 24 * u))
      ctx.textPosition = CGPoint(x: x + pad + 8 * u, y: y + bh - pad - 28 * u); CTLineDraw(title, ctx)
      if let s = sub { ctx.textPosition = CGPoint(x: x + pad + 8 * u, y: y + pad + 4 * u); CTLineDraw(s, ctx) }
    }
    ctx.restoreGState()
  }
  reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
  let group = DispatchGroup()
  group.enter()
  var last: CMSampleBuffer?
  var held = 0
  let holdFrames = Int(hold * 60)
  vIn.requestMediaDataWhenReady(on: DispatchQueue(label: "v")) {
    while vIn.isReadyForMoreMediaData {
      guard let b = vOut.copyNextSampleBuffer() else {
        // freeze: the last frame (already captioned) again, at 60 fps, for <hold> seconds
        if let l = last, held < holdFrames {
          held += 1
          var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 60),
                                          presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(l) + CMTime(value: CMTimeValue(held), timescale: 60),
                                          decodeTimeStamp: .invalid)
          var copy: CMSampleBuffer?
          CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: l, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy)
          vIn.append(copy!)
          continue
        }
        vIn.markAsFinished(); group.leave(); return
      }
      last = b
      let t = CMSampleBufferGetPresentationTimeStamp(b).seconds
      if let px = CMSampleBufferGetImageBuffer(b) {
        let active = caps.filter { t >= $0.s && t < $0.e }
        if !active.isEmpty {
          CVPixelBufferLockBaseAddress(px, [])
          let ctx = CGContext(data: CVPixelBufferGetBaseAddress(px), width: CVPixelBufferGetWidth(px), height: CVPixelBufferGetHeight(px),
                              bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(px), space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
          for c in active { let f = c.f ?? (c.style == "stamp" ? 0.15 : 0.35); draw(ctx, c, CGFloat(min(1, (t - c.s) / f, (c.e - t) / f)), t) }
          CVPixelBufferUnlockBaseAddress(px, [])
        }
      }
      vIn.append(b)
    }
  }
  if let i = aIn, let o = aOut {
    group.enter()
    i.requestMediaDataWhenReady(on: DispatchQueue(label: "a")) {
      while i.isReadyForMoreMediaData {
        if let b = o.copyNextSampleBuffer() { i.append(b) } else { i.markAsFinished(); group.leave(); return }
      }
    }
  }
  group.wait()
  let semC = DispatchSemaphore(value: 0)
  writer.finishWriting { semC.signal() }
  semC.wait()
  if writer.status != .completed { fail("caption failed: \(String(describing: writer.error ?? reader.error))") }
  let cbytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB)", out.lastPathComponent, Double(cbytes) / 1e6))

case "stabilize":
  // stabilize <in> <out.mp4> <kbps> [window = 0.7 s] [zoom = 1.08]
  // Pass 1 measures the shift between consecutive frames (Vision image registration) and builds the camera
  // path. The path is smoothed with a moving average over the window; each frame is then shifted by
  // (smooth - path), within the margin the zoom leaves. Jumps (cuts, cross-fades) are not followed.
  // Prints the shake (mean distance of the path from its smoothed version) and the fastest moments.
  // With <out> = "-" it only measures.
  let outPath = args[3]
  let kbps = Int(args[4]) ?? 4000
  let window = args.count > 5 ? Double(args[5])! : 0.7
  let zoom = CGFloat(args.count > 6 ? Double(args[6])! : 1.08)
  let srcV = load { try await asset.loadTracks(withMediaType: .video) }.first!
  let srcA = load { try await asset.loadTracks(withMediaType: .audio) }.first
  let size = load { try await srcV.load(.naturalSize) }
  let fps = Double(load { try await srcV.load(.nominalFrameRate) })
  func frames(_ body: (CVPixelBuffer, CMTime) -> Void) {
    let r = try! AVAssetReader(asset: asset)
    let o = AVAssetReaderTrackOutput(track: srcV, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    r.add(o); r.startReading()
    while let b = o.copyNextSampleBuffer() { if let px = CMSampleBufferGetImageBuffer(b) { body(px, CMSampleBufferGetPresentationTimeStamp(b)) } }
  }
  var dx: [Double] = [], dy: [Double] = [], times: [Double] = []
  var prev: CVPixelBuffer?
  frames { px, t in
    var x = 0.0, y = 0.0
    if let p = prev {
      let req = VNTranslationalImageRegistrationRequest(targetedCVPixelBuffer: p)
      try? VNImageRequestHandler(cvPixelBuffer: px, options: [:]).perform([req])
      if let o = req.results?.first as? VNImageTranslationAlignmentObservation {
        x = Double(o.alignmentTransform.tx); y = Double(o.alignmentTransform.ty)
      }
      if abs(x) > Double(size.width) * 0.06 || abs(y) > Double(size.height) * 0.06 { x = 0; y = 0 } // a cut, not motion
    }
    dx.append(x); dy.append(y); times.append(t.seconds); prev = px
  }
  let n = dx.count
  func path(_ d: [Double]) -> [Double] { var a = 0.0; return d.map { a += $0; return a } }
  func smooth(_ p: [Double]) -> [Double] {
    let h = max(1, Int(window * fps / 2))
    var pre = [0.0]; for v in p { pre.append(pre.last! + v) }
    return (0..<p.count).map { i in let a = max(0, i - h), b = min(p.count - 1, i + h); return (pre[b + 1] - pre[a]) / Double(b - a + 1) }
  }
  let px = path(dx), py = path(dy), sx = smooth(px), sy = smooth(py)
  let shake = (0..<n).map { hypot(sx[$0] - px[$0], sy[$0] - py[$0]) }.reduce(0, +) / Double(max(1, n))
  print(String(format: "frames %d, shake %.2f px (mean distance from the smoothed path)", n, shake))
  // fastest half seconds
  let per = Int(fps / 2)
  var speeds: [(Double, Double)] = []
  var i0 = 0
  while i0 + per <= n { speeds.append((times[i0], (i0..<i0 + per).map { hypot(dx[$0], dy[$0]) }.reduce(0, +) * 2)); i0 += per }
  print("fastest moments (px/s): " + speeds.sorted { $0.1 > $1.1 }.prefix(10).sorted { $0.0 < $1.0 }.map { String(format: "%.1fs:%.0f", $0.0, $0.1) }.joined(separator: " "))
  if outPath == "-" { break }
  let mx = Double(size.width) * Double(zoom - 1) / 2, my = Double(size.height) * Double(zoom - 1) / 2
  let reader = try! AVAssetReader(asset: asset)
  let vOut = AVAssetReaderTrackOutput(track: srcV, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  reader.add(vOut)
  var aOut: AVAssetReaderTrackOutput?
  if let a = srcA { let o = AVAssetReaderTrackOutput(track: a, outputSettings: nil); reader.add(o); aOut = o }
  let out = URL(fileURLWithPath: outPath)
  try? FileManager.default.removeItem(at: out)
  let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
  let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: Int(size.width), kCVPixelBufferHeightKey as String: Int(size.height)])
  writer.add(vIn)
  var aIn: AVAssetWriterInput?
  if let a = srcA {
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: load { try await a.load(.formatDescriptions) }.first)
    writer.add(i); aIn = i
  }
  let ci = CIContext()
  let sgnX = ProcessInfo.processInfo.environment["STAB_SX"].flatMap(Double.init) ?? 1
  let sgnY = ProcessInfo.processInfo.environment["STAB_SY"].flatMap(Double.init) ?? 1
  reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
  let group = DispatchGroup()
  var k = 0
  group.enter()
  vIn.requestMediaDataWhenReady(on: DispatchQueue(label: "v")) {
    while vIn.isReadyForMoreMediaData {
      guard let b = vOut.copyNextSampleBuffer(), let src = CMSampleBufferGetImageBuffer(b) else { vIn.markAsFinished(); group.leave(); return }
      let i = min(k, n - 1); k += 1
      let cx = max(-mx, min(mx, (sx[i] - px[i]) * sgnX)), cy = max(-my, min(my, (sy[i] - py[i]) * sgnY))
      // Lanczos for the zoom (sharper than the default sampling), then the sub-pixel shift
      var img = CIImage(cvPixelBuffer: src).applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: zoom, kCIInputAspectRatioKey: 1])
      img = img.transformed(by: CGAffineTransform(translationX: -size.width * (zoom - 1) / 2 + CGFloat(cx), y: -size.height * (zoom - 1) / 2 + CGFloat(cy)))
      var dst: CVPixelBuffer?
      CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &dst)
      ci.render(img, to: dst!, bounds: CGRect(origin: .zero, size: size), colorSpace: CGColorSpaceCreateDeviceRGB())
      adaptor.append(dst!, withPresentationTime: CMSampleBufferGetPresentationTimeStamp(b))
    }
  }
  if let i = aIn, let o = aOut {
    group.enter()
    i.requestMediaDataWhenReady(on: DispatchQueue(label: "a")) {
      while i.isReadyForMoreMediaData {
        if let b = o.copyNextSampleBuffer() { i.append(b) } else { i.markAsFinished(); group.leave(); return }
      }
    }
  }
  group.wait()
  let semS = DispatchSemaphore(value: 0)
  writer.finishWriting { semS.signal() }
  semS.wait()
  if writer.status != .completed { fail("stabilize failed: \(String(describing: writer.error ?? reader.error))") }
  print("wrote \(out.lastPathComponent)")

case "levels":
  // levels <in> <step>: RMS and peak (dBFS) of the audio per step, to spot voices before publishing.
  let step = Double(args[3])!
  guard let a = load({ try await asset.loadTracks(withMediaType: .audio) }).first else { fail("no audio") }
  let reader = try! AVAssetReader(asset: asset)
  let o = AVAssetReaderTrackOutput(track: a, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32,
    AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVNumberOfChannelsKey: 1, AVSampleRateKey: 16000])
  reader.add(o); reader.startReading()
  var bucket = 0, sum = 0.0, n = 0, peak: Float = 0
  func flush() {
    if n > 0 { print(String(format: "%6.1f s  rms %6.1f dB  peak %6.1f dB", Double(bucket) * step, 20 * log10(max(1e-9, (sum / Double(n)).squareRoot())), 20 * log10(max(1e-9, Double(peak))))) }
    sum = 0; n = 0; peak = 0
  }
  while let b = o.copyNextSampleBuffer() {
    let t0 = CMSampleBufferGetPresentationTimeStamp(b).seconds
    guard let bb = CMSampleBufferGetDataBuffer(b) else { continue }
    var len = 0; var ptr: UnsafeMutablePointer<Int8>?
    CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
    let count = len / 4
    ptr!.withMemoryRebound(to: Float.self, capacity: count) { f in
      for i in 0..<count {
        let k = Int((t0 + Double(i) / 16000) / step)
        if k != bucket { flush(); bucket = k }
        sum += Double(f[i] * f[i]); n += 1; peak = max(peak, abs(f[i]))
      }
    }
  }
  flush()

case "gif":
  // gif <in> <out.gif> <width> <fps> [start] [end]: looping animated GIF for places that do not play video
  let width = Double(args[4])!, fps = Double(args[5])!
  let dur = load { try await asset.load(.duration) }.seconds
  let start = args.count > 6 ? Double(args[6])! : 0, end = args.count > 7 ? Double(args[7])! : dur
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  gen.maximumSize = CGSize(width: width, height: width)
  gen.requestedTimeToleranceBefore = .zero
  gen.requestedTimeToleranceAfter = .zero
  let n = Int((end - start) * fps)
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[3]) as CFURL, "com.compuserve.gif" as CFString, n, nil)!
  CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
  let frameProps = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFUnclampedDelayTime: 1.0 / fps, kCGImagePropertyGIFDelayTime: 1.0 / fps]] as CFDictionary
  for i in 0..<n {
    if let img = try? gen.copyCGImage(at: CMTime(seconds: start + Double(i) / fps, preferredTimescale: 600), actualTime: nil) {
      CGImageDestinationAddImage(dest, img, frameProps)
    }
  }
  if !CGImageDestinationFinalize(dest) { fail("gif failed") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: args[3])[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %d frames)", (args[3] as NSString).lastPathComponent, Double(bytes) / 1e6, n))

case "frame":
  // frame <in> <out.jpg> <sec>: one full-size still (poster image)
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  // posters: at most 1280 x 720; "full" as 5th argument keeps the video size (for sharpness checks; .png = lossless)
  let full = args.count > 5 && args[5] == "full"
  gen.maximumSize = full ? .zero : CGSize(width: 1280, height: 720)
  gen.requestedTimeToleranceBefore = .zero; gen.requestedTimeToleranceAfter = .zero
  let img = try! gen.copyCGImage(at: CMTime(seconds: Double(args[4])!, preferredTimescale: 600), actualTime: nil)
  let rep = NSBitmapImageRep(cgImage: img)
  let png = args[3].lowercased().hasSuffix(".png")
  try! rep.representation(using: png ? .png : .jpeg, properties: png ? [:] : [.compressionFactor: 0.8])!.write(to: URL(fileURLWithPath: args[3]))
  print("wrote \(args[3])")

default:
  fail("unknown command")
}
