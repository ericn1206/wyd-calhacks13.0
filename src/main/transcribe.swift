import Speech
import Foundation

guard CommandLine.arguments.count > 1 else {
    fputs("error:noFile\n", stderr)
    exit(1)
}

let audioURL = URL(fileURLWithPath: CommandLine.arguments[1])
let semaphore = DispatchSemaphore(value: 0)

SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        print("error:notAuthorized")
        semaphore.signal()
        return
    }

    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
          recognizer.isAvailable else {
        print("error:notAvailable")
        semaphore.signal()
        return
    }

    let request = SFSpeechURLRecognitionRequest(url: audioURL)
    request.shouldReportPartialResults = false

    recognizer.recognitionTask(with: request) { result, error in
        if let result = result, result.isFinal {
            print(result.bestTranscription.formattedString)
            semaphore.signal()
        } else if let error = error {
            let code = (error as NSError).code
            if code == 301 || code == 203 {
                semaphore.signal()
            } else {
                print("error:\(error.localizedDescription)")
                semaphore.signal()
            }
        }
    }
}

semaphore.wait()
