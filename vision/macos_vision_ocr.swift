import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 2 else {
    fputs("usage: macos_vision_ocr <image>\n", stderr)
    exit(2)
}

let url = URL(fileURLWithPath: args[1])
guard let image = NSImage(contentsOf: url) else {
    fputs("could not read image\n", stderr)
    exit(1)
}

var proposed = CGRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &proposed, context: nil, hints: nil) else {
    fputs("could not read image\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("ocr failed: \(error)\n", stderr)
    exit(1)
}

let observations = request.results ?? []
let sorted = observations.sorted { $0.boundingBox.origin.y > $1.boundingBox.origin.y }
let lines = sorted.compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
