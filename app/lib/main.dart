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
  late final api = Api(null);
  ThemeMode themeMode = ThemeMode.system;

  void setToken(String? t) {
    setState(() => api.token = t);
    widget.prefs.remove(
      'token',
    ); // Keep access tokens in memory; no plaintext persistence.
  }

  void setTheme(String theme) => setState(
    () => themeMode = switch (theme) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    },
  );

  ThemeData _theme(Brightness b) => ThemeData(
    colorScheme: ColorScheme.fromSeed(
      seedColor: keyColor,
      brightness: b,
      primary: b == Brightness.light
          ? const Color(0xFFE07A00)
          : const Color(0xFFFFB347),
    ),
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
          : HomeScreen(
              api: api,
              onLogout: () => setToken(null),
              onTheme: setTheme,
            ),
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
  final nick = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  bool registering = false;
  String? error;
  bool busy = false;

  Future<void> login() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final token = registering
          ? await widget.api.register(nick.text, email.text, password.text)
          : await widget.api.login(email.text, password.text);
      if (mounted) widget.onLogin(token);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    nick.dispose();
    email.dispose();
    password.dispose();
    super.dispose();
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
                ClipRRect(
                  borderRadius: BorderRadius.circular(28),
                  child: Image.asset(
                    'assets/icon.png',
                    width: 112,
                    height: 112,
                    semanticLabel: '플잉 앱 아이콘',
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  '플잉',
                  style: t.displaySmall?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  'ADHD를 위한 다정한 일정·공부 메이트',
                  style: t.titleMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                if (registering)
                  TextField(
                    controller: nick,
                    maxLength: 30,
                    decoration: const InputDecoration(
                      labelText: '닉네임',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => login(),
                  ),
                const SizedBox(height: 8),
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: '이메일',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: password,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '비밀번호 · 10자 이상',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) {
                    if (!busy) login();
                  },
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          registering = !registering;
                          error = null;
                        }),
                  child: Text(
                    registering ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 계정 만들기',
                  ),
                ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: busy ? null : login,
                    child: const Padding(
                      padding: EdgeInsets.all(14),
                      child: Text('시작하기'),
                    ),
                  ),
                ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
