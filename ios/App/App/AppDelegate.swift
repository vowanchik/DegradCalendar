import UIKit
import Capacitor
import EventKit
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
        CAPPluginMethod(name: "saveCalendar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeCalendar", returnType: CAPPluginReturnPromise)
    ]
    private let events = EKEventStore()
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
    private func calendarAccess(_ call: CAPPluginCall, action: @escaping () -> Void) {
        let callback: (Bool, Error?) -> Void = { granted, error in
            DispatchQueue.main.async {
                if granted { action() } else { call.reject("Разрешите доступ к календарю в настройках iPhone. Ответ на приглашение уже сохранён.", nil, error) }
            }
        }
        if #available(iOS 17.0, *) { events.requestFullAccessToEvents(completion: callback) }
        else { events.requestAccess(to: .event, completion: callback) }
    }
    @objc func saveCalendar(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let title = call.getString("title"), let start = call.getDouble("startMs"), let end = call.getDouble("endMs"), end > start else { call.reject("Неверные данные встречи"); return }
        calendarAccess(call) { [self] in
            let mapping = "partyup.calendar." + key
            let previous = UserDefaults.standard.string(forKey: mapping)
            let event = previous.flatMap { events.event(withIdentifier: $0) } ?? EKEvent(eventStore: events)
            if event.calendar == nil { event.calendar = events.defaultCalendarForNewEvents }
            guard event.calendar != nil else { call.reject("На телефоне нет календаря для записи. Добавьте его в системных настройках."); return }
            event.title = title; event.startDate = Date(timeIntervalSince1970: start / 1000); event.endDate = Date(timeIntervalSince1970: end / 1000)
            event.notes = call.getString("notes") ?? ""; event.location = call.getString("location") ?? ""; event.alarms = [EKAlarm(relativeOffset: -900)]
            do { try events.save(event, span: .thisEvent); UserDefaults.standard.set(event.eventIdentifier, forKey: mapping); call.resolve() }
            catch { call.reject("Не удалось сохранить встречу в календарь", nil, error) }
        }
    }
    @objc func removeCalendar(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("Неверный идентификатор"); return }
        let mapping = "partyup.calendar." + key
        guard let id = UserDefaults.standard.string(forKey: mapping) else { call.resolve(); return }
        let status = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, *) { guard status == .fullAccess else { call.reject("Нет доступа к календарю"); return } }
        else { guard status == .authorized else { call.reject("Нет доступа к календарю"); return } }
        DispatchQueue.main.async { [self] in
            do { if let event = events.event(withIdentifier: id) { try events.remove(event, span: .thisEvent) }; UserDefaults.standard.removeObject(forKey: mapping); call.resolve() }
            catch { call.reject("Не удалось удалить отменённую встречу", nil, error) }
        }
    }
}
