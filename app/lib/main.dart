import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'screens.dart';

const keyColor = Color(0xFFFF9000);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(PlingApp(prefs: prefs));
}

class PlingApp extends StatefulWidget {
  const PlingApp({super.key, required this.prefs});
  final SharedPreferences prefs;

  @override
  State<PlingApp> createState() => _PlingAppState();
}

class _PlingAppState extends State<PlingApp> {
  late final api = Api(widget.prefs.getString('token'));
  ThemeMode themeMode = ThemeMode.system;

  void setToken(String? t) {
    setState(() => api.token = t);
    t == null ? widget.prefs.remove('token') : widget.prefs.setString('token', t);
  }

  void setTheme(String theme) => setState(() => themeMode = switch (theme) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      });

  ThemeData _theme(Brightness b) => ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: keyColor, brightness: b, primary: b == Brightness.light ? const Color(0xFFE07A00) : const Color(0xFFFFB347)),
        useMaterial3: true,
      );

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '플잉',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      themeMode: themeMode,
      home: api.token == null
          ? LoginScreen(api: api, onLogin: setToken)
          : HomeScreen(api: api, onLogout: () => setToken(null), onTheme: setTheme),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onLogin});
  final Api api;
  final void Function(String) onLogin;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final nick = TextEditingController(text: '테스터');
  String? error;
  bool busy = false;

  Future<void> login() async {
    setState(() { busy = true; error = null; });
    try {
      widget.onLogin(await widget.api.devLogin(nick.text));
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                ClipRRect(borderRadius: BorderRadius.circular(28), child: Image.asset('assets/icon.png', width: 112, height: 112, semanticLabel: '플잉 앱 아이콘')),
                const SizedBox(height: 16),
                Text('플잉', style: t.displaySmall?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text('ADHD를 위한 다정한 일정·공부 메이트', style: t.titleMedium, textAlign: TextAlign.center),
                const SizedBox(height: 32),
                TextField(
                  controller: nick,
                  maxLength: 30,
                  decoration: const InputDecoration(labelText: '닉네임', border: OutlineInputBorder()),
                  onSubmitted: (_) => login(),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(onPressed: busy ? null : login, child: const Padding(padding: EdgeInsets.all(14), child: Text('시작하기'))),
                ),
                if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                const SizedBox(height: 24),
                // 실제 공급자 연동 전까지 숨기지 않고 밝힌다.
                Text('테스트 로그인이에요. Google·Apple 로그인은 아직 연결되지 않았어요.\n서버: $apiBase', style: t.bodySmall, textAlign: TextAlign.center),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
