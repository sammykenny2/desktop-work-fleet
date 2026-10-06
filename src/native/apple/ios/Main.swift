import UIKit

@main @MainActor final class FleetApp: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
}

// The iOS 27 SDK terminates apps that have not adopted the UIScene life cycle.
// The host holds the workspace lock and background save for the whole process, so a reconnected scene reuses it.
@MainActor final class FleetSceneDelegate: UIResponder, UIWindowSceneDelegate {
    private static var host: FleetWebHost?
    private static var background: UIBackgroundTaskIdentifier = .invalid
    private static var backgroundID: String?
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        // The page stops at the safe area; the strips beyond it show this view, so it matches the page's desk color.
        let window = UIWindow(windowScene: scene); let controller = UIViewController(); controller.view.backgroundColor = UIColor(red: 0xF3 / 255, green: 0xF5 / 255, blue: 0xF4 / 255, alpha: 1); window.rootViewController = controller; self.window = window; window.makeKeyAndVisible()
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("WorkFleet", isDirectory: true)
            let host = try Self.host ?? FleetWebHost(directory: directory); Self.host = host; host.presenter = controller
            host.backgroundFinished = { id in if Self.backgroundID == id { Self.endBackground() } }
            let web = host.web; web.translatesAutoresizingMaskIntoConstraints = false; controller.view.addSubview(web)
            NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.bottomAnchor), web.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor), web.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor)])
            web.scrollView.keyboardDismissMode = .interactive
        } catch { let alert = UIAlertController(title: "Work Fleet", message: (error as? FleetFailure)?.message ?? "無法開啟安全工作空間，請保留 App 資料並重試。", preferredStyle: .alert); alert.addAction(UIAlertAction(title: "確定", style: .default)); controller.present(alert, animated: true) }
        open(connectionOptions.urlContexts)
    }
    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) { open(contexts) }
    private func open(_ contexts: Set<UIOpenURLContext>) { for context in contexts { _ = FleetGoogle.handle(context.url) } }
    private static func endBackground() {
        if background != .invalid { UIApplication.shared.endBackgroundTask(background) }; background = .invalid; backgroundID = nil
    }
    func sceneDidEnterBackground(_ scene: UIScene) {
        Self.endBackground(); let id = FleetProtocol.uuid(); Self.backgroundID = id
        Self.background = UIApplication.shared.beginBackgroundTask(withName: "Save Work Fleet drafts") { Self.endBackground() }
        Self.host?.event("host-background", ["id": id])
    }
    func sceneWillEnterForeground(_ scene: UIScene) { Self.endBackground(); Self.host?.event("host-foreground") }
}
