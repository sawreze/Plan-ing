import Flutter
import SwiftUI
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // 하단 탭 바: iOS 네이티브 Liquid Glass
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "PlingGlassTabBar") {
      registrar.register(
        GlassTabBarFactory(messenger: registrar.messenger()),
        withId: "pling/glass_tab_bar")
    }
  }
}

// MARK: - Liquid Glass 하단 탭 바 (Flutter UiKitView로 삽입)

final class GlassTabBarFactory: NSObject, FlutterPlatformViewFactory {
  private let messenger: FlutterBinaryMessenger
  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
    super.init()
  }

  func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?)
    -> FlutterPlatformView
  {
    GlassTabBarPlatformView(frame: frame, viewId: viewId, args: args, messenger: messenger)
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}

final class GlassTabModel: ObservableObject {
  @Published var index: Int
  var onSelect: (Int) -> Void = { _ in }
  init(index: Int) { self.index = index }
}

final class GlassTabBarPlatformView: NSObject, FlutterPlatformView {
  private let model: GlassTabModel
  private let channel: FlutterMethodChannel
  private let host: UIHostingController<GlassTabBar>

  init(frame: CGRect, viewId: Int64, args: Any?, messenger: FlutterBinaryMessenger) {
    let start = (args as? [String: Any])?["index"] as? Int ?? 0
    model = GlassTabModel(index: start)
    channel = FlutterMethodChannel(
      name: "pling/glass_tab_bar_\(viewId)", binaryMessenger: messenger)
    host = UIHostingController(rootView: GlassTabBar(model: model))
    super.init()
    host.view.frame = frame
    host.view.backgroundColor = .clear
    if #available(iOS 16.4, *) { host.safeAreaRegions = [] }
    model.onSelect = { [weak self] i in self?.channel.invokeMethod("select", arguments: i) }
    channel.setMethodCallHandler { [weak self] call, result in
      if call.method == "setIndex", let i = call.arguments as? Int, let self {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { self.model.index = i }
      }
      result(nil)
    }
  }

  func view() -> UIView { host.view }
}

struct GlassTabBar: View {
  @ObservedObject var model: GlassTabModel
  @Namespace private var ns
  private let items: [(icon: String, label: String)] = [
    ("calendar", "계획"), ("timer", "집중"), ("sparkles", "AI"),
    ("flag", "목표"), ("gearshape", "설정"),
  ]
  private let key = Color(red: 1.0, green: 0.565, blue: 0.0)  // #FF9000

  var body: some View {
    HStack(spacing: 0) {
      ForEach(items.indices, id: \.self) { i in
        Button {
          withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { model.index = i }
          model.onSelect(i)
        } label: {
          VStack(spacing: 3) {
            Image(systemName: items[i].icon).font(.system(size: 19, weight: .semibold))
            Text(items[i].label).font(.system(size: 10, weight: .semibold))
          }
          .foregroundStyle(model.index == i ? key : Color.primary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background {
            if model.index == i {
              Capsule().fill(key.opacity(0.18)).matchedGeometryEffect(id: "selected", in: ns)
            }
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(5)
    .modifier(LiquidGlassBackground())
  }
}

struct LiquidGlassBackground: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.glassEffect(.regular.interactive(), in: Capsule())
    } else {
      content.background(.ultraThinMaterial, in: Capsule())
    }
  }
}
