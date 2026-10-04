import UIKit

@main @MainActor final class FleetApp: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var host: FleetWebHost?
    private var background: UIBackgroundTaskIdentifier = .invalid
    private var backgroundID: String?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds); let controller = UIViewController(); controller.view.backgroundColor = .systemBackground; window.rootViewController = controller; self.window = window; window.makeKeyAndVisible()
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("WorkFleet", isDirectory: true)
            let host = try FleetWebHost(directory: directory); self.host = host; host.presenter = controller
            host.backgroundFinished = { [weak self] id in if self?.backgroundID == id { self?.endBackground() } }
            let web = host.web; web.translatesAutoresizingMaskIntoConstraints = false; controller.view.addSubview(web)
            NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.bottomAnchor), web.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor), web.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor)])
            web.scrollView.keyboardDismissMode = .interactive
        } catch { let alert = UIAlertController(title: "Work Fleet", message: (error as? FleetFailure)?.message ?? "無法開啟安全工作空間，請保留 App 資料並重試。", preferredStyle: .alert); alert.addAction(UIAlertAction(title: "確定", style: .default)); controller.present(alert, animated: true) }
        return true
    }
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool { FleetGoogle.handle(url) }
    private func endBackground() {
        if background != .invalid { UIApplication.shared.endBackgroundTask(background) }; background = .invalid; backgroundID = nil
    }
    func applicationDidEnterBackground(_ application: UIApplication) {
        endBackground(); let id = FleetProtocol.uuid(); backgroundID = id
        background = application.beginBackgroundTask(withName: "Save Work Fleet drafts") { [weak self] in self?.endBackground() }
        host?.event("host-background", ["id": id])
    }
    func applicationWillEnterForeground(_ application: UIApplication) { endBackground(); host?.event("host-foreground") }
}
