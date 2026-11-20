import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// iOS에서는 SwiftUI 네이티브 Liquid Glass 탭 바(ios/Runner/AppDelegate.swift)를,
/// 그 외 플랫폼에서는 Material NavigationBar를 보여준다.
class GlassTabBar extends StatefulWidget {
  const GlassTabBar({super.key, required this.index, required this.onSelect});
  final int index;
  final ValueChanged<int> onSelect;

  static bool get isNative =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  @override
  State<GlassTabBar> createState() => _GlassTabBarState();
}

class _GlassTabBarState extends State<GlassTabBar> {
  MethodChannel? _channel;

  void _onCreated(int id) {
    _channel = MethodChannel('pling/glass_tab_bar_$id')
      ..setMethodCallHandler((call) async {
        if (call.method == 'select') widget.onSelect(call.arguments as int);
      });
  }

  @override
  void didUpdateWidget(GlassTabBar old) {
    super.didUpdateWidget(old);
    if (old.index != widget.index) {
      _channel?.invokeMethod('setIndex', widget.index);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!GlassTabBar.isNative) {
      return NavigationBar(
        selectedIndex: widget.index,
        onDestinationSelected: widget.onSelect,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.calendar_today_outlined),
            label: '계획',
          ),
          NavigationDestination(icon: Icon(Icons.timer_outlined), label: '집중'),
          NavigationDestination(icon: Icon(Icons.auto_awesome), label: 'AI'),
          NavigationDestination(icon: Icon(Icons.flag_outlined), label: '목표'),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            label: '설정',
          ),
        ],
      );
    }
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: SizedBox(
          height: 62,
          child: UiKitView(
            viewType: 'pling/glass_tab_bar',
            creationParams: {'index': widget.index},
            creationParamsCodec: const StandardMessageCodec(),
            onPlatformViewCreated: _onCreated,
          ),
        ),
      ),
    );
  }
}
