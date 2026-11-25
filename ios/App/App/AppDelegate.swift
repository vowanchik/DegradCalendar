import UIKit
import Capacitor
import AVFoundation
import AudioToolbox
import CryptoKit
import Security
import FirebaseCore

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil { FirebaseApp.configure() }
        return true
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }
}

class PartyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(PartyNativePlugin()) }
}

@objc(PartyNativePlugin)
public class PartyNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PartyNativePlugin"
    public let jsName = "PartyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSound", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "previewSound", returnType: CAPPluginReturnPromise)
    ]
    private var preview: AVAudioPlayer?
    private var keychainQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.partyup.session", kSecAttrAccount as String: "session"] }
    @objc func getToken(_ call: CAPPluginCall) {
        var query = keychainQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { call.resolve(["value": ""]); return }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("Не удалось прочитать сессию из Keychain"); return }
        call.resolve(["value": value])
    }
    @objc func setToken(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), value.count <= 1024, let data = value.data(using: .utf8) else { call.reject("Неверная сессия"); return }
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(keychainQuery as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var query = keychainQuery; query[kSecValueData as String] = data; query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(query as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() } else { call.reject("Не удалось сохранить сессию в Keychain") }
    }
    @objc func clearToken(_ call: CAPPluginCall) {
        let status = SecItemDelete(keychainQuery as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("Не удалось удалить сессию") }
    }
    private func soundKey(_ call: CAPPluginCall) -> String? {
        guard let scope = call.getString("scope"), scope.count <= 1000, let kind = call.getString("kind"), ["invite", "reply", "decline", "message", "friend", "cancel", "reminder"].contains(kind) else { return nil }
        return "partyup.sound." + SHA256.hash(data: Data((scope + ":" + kind).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    @objc func setSound(_ call: CAPPluginCall) {
        guard let key = soundKey(call) else { call.reject("Неверный запрос звука"); return }
        if call.getBool("reset") == true { UserDefaults.standard.removeObject(forKey: key); call.resolve(); return }
        guard let name = call.getString("name"), name.count <= 200, let url = call.getString("dataUrl"), url.count <= 2800000, url.hasPrefix("data:audio/"), let comma = url.range(of: ";base64,"), let data = Data(base64Encoded: String(url[comma.upperBound...])), data.count <= 2 * 1024 * 1024 else { call.reject("Выберите звуковой файл до 2 МБ"); return }
        let ext = (name as NSString).pathExtension.lowercased()
        guard ["wav", "caf", "aif", "aiff"].contains(ext) else { call.reject("Для iPhone выберите WAV, CAF или AIFF"); return }
        do {
            let source = try AVAudioPlayer(data: data)
            guard source.duration > 0 && source.duration < 30 else { call.reject("Длительность звука должна быть меньше 30 секунд"); return }
            // APNs supports PCM/ADPCM. Normalize imported audio to PCM WAV.
            let directory = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Sounds", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let digest = SHA256.hash(data: Data(key.utf8) + data).map { String(format: "%02x", $0) }.joined()
            let file = "partyup-" + digest + ".wav"
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
            try data.write(to: temporary, options: .atomic)
            defer { try? FileManager.default.removeItem(at: temporary) }
            let input = try AVAudioFile(forReading: temporary)
            let format = input.processingFormat
            let output = try AVAudioFile(forWriting: directory.appendingPathComponent(file), settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(input.length)) else { call.reject("Не удалось обработать звук"); return }
            try input.read(into: buffer)
            try output.write(from: buffer)
            UserDefaults.standard.set(file, forKey: key)
            call.resolve(["name": name, "soundName": file])
        } catch { call.reject("Не удалось сохранить звук: используйте WAV, CAF или AIFF", nil, error) }
    }
    @objc func previewSound(_ call: CAPPluginCall) {
        guard let key = soundKey(call) else { call.reject("Неверный запрос звука"); return }
        preview?.stop()
        guard let file = UserDefaults.standard.string(forKey: key) else { AudioServicesPlayAlertSound(1007); call.resolve(); return }
        do {
            let url = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Sounds").appendingPathComponent(file)
            preview = try AVAudioPlayer(contentsOf: url); preview?.play(); call.resolve()
        } catch { call.reject("Не удалось воспроизвести звук", nil, error) }
    }
}
